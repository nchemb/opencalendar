/**
 * Durable outbox.
 *
 * A booking row is committed first; everything that talks to the outside world
 * afterwards (calendar writes, emails, webhooks, reminders, refunds) is a Job row
 * processed here. Jobs are claimed with FOR UPDATE SKIP LOCKED so any number of
 * workers (cron tick, the request that created the booking, the admin retry
 * button) can drain concurrently without running a job twice at the same time.
 * Failures back off exponentially; a job that exhausts its attempts is marked
 * dead and raises an alert — it is never silently dropped.
 */
import type { Job, Prisma } from "@prisma/client";
import { prisma } from "./db";
import { errorMessage, log } from "./logger";

export type JobKind =
  | "calendar.create"
  | "calendar.update"
  | "calendar.delete"
  | "email"
  | "webhook"
  | "reminder"
  | "followup"
  | "refund";

/** Thrown by a handler that should stop retrying (e.g. booking no longer exists). */
export class PermanentJobError extends Error {}

type Handler = (job: Job) => Promise<void>;
const handlers = new Map<string, Handler>();

export function registerJobHandler(kind: JobKind, handler: Handler) {
  handlers.set(kind, handler);
}

type Client = Pick<typeof prisma, "job">;

export type EnqueueOptions = {
  bookingId?: string | null;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
};

/** Add a job. Duplicate dedupe keys are a no-op (the job already exists). */
export async function enqueue(
  kind: JobKind,
  payload: Record<string, unknown>,
  opts: EnqueueOptions = {},
  client: Client = prisma
): Promise<void> {
  try {
    await client.job.create({
      data: {
        kind,
        payload: payload as Prisma.InputJsonValue,
        bookingId: opts.bookingId ?? null,
        runAt: opts.runAt ?? new Date(),
        dedupeKey: opts.dedupeKey ?? null,
        maxAttempts: opts.maxAttempts ?? 8,
      },
    });
  } catch (err) {
    if ((err as { code?: string })?.code === "P2002") return; // dedupe hit
    throw err;
  }
}

/** Backoff: 30s, 1m, 2m, 4m ... capped at 3h. */
export function backoffMs(attempts: number): number {
  return Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 3 * 3_600_000);
}

const LOCK_MS = 2 * 60_000;

async function claim(limit: number, bookingId?: string): Promise<Job[]> {
  const lockUntil = new Date(Date.now() + LOCK_MS);
  // Raw SQL for SKIP LOCKED; Prisma has no API for it.
  const rows = bookingId
    ? await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Job" SET "lockedUntil" = ${lockUntil}, "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "Job"
          WHERE "doneAt" IS NULL AND "deadAt" IS NULL AND "runAt" <= now()
            AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
            AND "bookingId" = ${bookingId}
          ORDER BY "runAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id"`
    : await prisma.$queryRaw<{ id: string }[]>`
        UPDATE "Job" SET "lockedUntil" = ${lockUntil}, "attempts" = "attempts" + 1
        WHERE "id" IN (
          SELECT "id" FROM "Job"
          WHERE "doneAt" IS NULL AND "deadAt" IS NULL AND "runAt" <= now()
            AND ("lockedUntil" IS NULL OR "lockedUntil" < now())
          ORDER BY "runAt" ASC
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED
        )
        RETURNING "id"`;
  if (!rows.length) return [];
  return prisma.job.findMany({ where: { id: { in: rows.map((r) => r.id) } }, orderBy: { runAt: "asc" } });
}

async function runOne(job: Job): Promise<"done" | "retry" | "dead"> {
  const handler = handlers.get(job.kind);
  try {
    if (!handler) throw new PermanentJobError(`no handler for job kind ${job.kind}`);
    await handler(job);
    await prisma.job.update({
      where: { id: job.id },
      data: { doneAt: new Date(), lockedUntil: null, lastError: null },
    });
    return "done";
  } catch (err) {
    const message = errorMessage(err).slice(0, 1000);
    const permanent = err instanceof PermanentJobError;
    const dead = permanent || job.attempts >= job.maxAttempts;
    await prisma.job.update({
      where: { id: job.id },
      data: dead
        ? { deadAt: new Date(), lockedUntil: null, lastError: message }
        : { runAt: new Date(Date.now() + backoffMs(job.attempts)), lockedUntil: null, lastError: message },
    });
    log[dead ? "error" : "warn"]("jobs", dead ? "dead" : "retry", {
      jobId: job.id,
      kind: job.kind,
      bookingId: job.bookingId,
      attempts: job.attempts,
      error: message,
    });
    if (dead && !permanent) {
      const { raiseAlert } = await import("./alerts");
      await raiseAlert({
        kind: "job_dead",
        severity: job.kind.startsWith("calendar") || job.kind === "refund" ? "critical" : "warning",
        title: `A ${job.kind} task failed ${job.attempts} times and stopped retrying`,
        message: `Job ${job.id}${job.bookingId ? ` for booking ${job.bookingId}` : ""}.\nLast error: ${message}\nRetry it from the booking page or the needs-attention list.`,
        bookingId: job.bookingId,
        key: `job_dead:${job.id}`,
      });
    }
    return dead ? "dead" : "retry";
  }
}

export type DrainResult = { done: number; retried: number; dead: number };

/**
 * Process due jobs until none are left or the time budget runs out.
 * `bookingId` limits the drain to one booking's jobs (used right after a booking).
 */
export async function drainJobs(
  opts: { budgetMs?: number; bookingId?: string; batch?: number } = {}
): Promise<DrainResult> {
  // Handlers register themselves on import.
  await import("./job-handlers");
  const deadline = Date.now() + (opts.budgetMs ?? 20_000);
  const result: DrainResult = { done: 0, retried: 0, dead: 0 };
  while (Date.now() < deadline) {
    const jobs = await claim(opts.batch ?? 10, opts.bookingId);
    if (!jobs.length) break;
    for (const job of jobs) {
      const r = await runOne(job);
      if (r === "done") result.done++;
      else if (r === "retry") result.retried++;
      else result.dead++;
      if (Date.now() >= deadline) break;
    }
  }
  return result;
}

/** Admin: put a dead or waiting job back at the front of the queue. */
export async function retryJobNow(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { deadAt: null, runAt: new Date(), lockedUntil: null, maxAttempts: { increment: 3 } },
  });
}

/** Admin: every unfinished job for a booking goes back to the front of the queue. */
export async function retryBookingJobs(bookingId: string): Promise<void> {
  await prisma.job.updateMany({
    where: { bookingId, doneAt: null },
    data: { deadAt: null, runAt: new Date(), lockedUntil: null },
  });
}
