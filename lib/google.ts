import { google, type calendar_v3 } from "googleapis";
import type { Host } from "@prisma/client";
import { prisma } from "./db";
import { env, googleRedirectUri, requireEnv } from "./env";
import { errorMessage, log } from "./logger";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
];

/** The host must reconnect Google before bookings can work again. */
export class GoogleAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleAuthError";
  }
}

/** Transient/unknown Google failure. Callers fail closed. */
export class GoogleApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GoogleApiError";
  }
}

export type BusyInterval = { start: Date; end: Date };

export function oauthClient() {
  return new google.auth.OAuth2(
    requireEnv("GOOGLE_CLIENT_ID"),
    requireEnv("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri()
  );
}

export function authUrl(state: string) {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // always return a refresh_token, even on reconnect
    scope: GOOGLE_SCOPES,
    state,
    include_granted_scopes: true,
  });
}

export async function exchangeCode(code: string) {
  const client = oauthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.refresh_token) {
    throw new Error(
      "Google did not return a refresh token. Revoke the app at myaccount.google.com/permissions and connect again."
    );
  }
  return tokens;
}

function isAuthFailure(err: unknown): boolean {
  const msg = errorMessage(err).toLowerCase();
  const code = (err as { code?: number | string })?.code;
  return (
    msg.includes("invalid_grant") ||
    msg.includes("invalid_client") ||
    msg.includes("unauthorized_client") ||
    msg.includes("token has been expired or revoked") ||
    code === 401 ||
    code === "401"
  );
}

/**
 * Returns an authorized Calendar client, refreshing the access token when stale.
 * Throws GoogleAuthError (and flags the host) when the refresh token is dead.
 */
export async function calendarClient(host: Host): Promise<calendar_v3.Calendar> {
  if (!host.googleRefreshToken) {
    throw new GoogleAuthError("Google Calendar is not connected.");
  }
  if (!env("GOOGLE_CLIENT_ID") || !env("GOOGLE_CLIENT_SECRET")) {
    throw new GoogleAuthError("Google OAuth credentials are not configured.");
  }

  const client = oauthClient();
  client.setCredentials({
    refresh_token: host.googleRefreshToken,
    access_token: host.googleAccessToken ?? undefined,
    expiry_date: host.googleTokenExpiresAt?.getTime() ?? undefined,
  });

  const expiresAt = host.googleTokenExpiresAt?.getTime() ?? 0;
  const stale = expiresAt - Date.now() < 60_000; // refresh a minute early

  if (stale) {
    try {
      const { credentials } = await client.refreshAccessToken();
      client.setCredentials(credentials);
      await prisma.host.update({
        where: { id: host.id },
        data: {
          googleAccessToken: credentials.access_token ?? null,
          googleTokenExpiresAt: credentials.expiry_date
            ? new Date(credentials.expiry_date)
            : null,
          ...(credentials.refresh_token
            ? { googleRefreshToken: credentials.refresh_token }
            : {}),
          googleAuthError: null,
        },
      });
      log.info("google", "token_refreshed", { hostId: host.id });
    } catch (err) {
      if (isAuthFailure(err)) {
        await markGoogleDisconnected(host, errorMessage(err));
        throw new GoogleAuthError("Google Calendar authorization has expired.");
      }
      throw new GoogleApiError(`Token refresh failed: ${errorMessage(err)}`);
    }
  }

  return google.calendar({ version: "v3", auth: client });
}

export async function markGoogleDisconnected(host: Host, reason: string) {
  await prisma.host.update({
    where: { id: host.id },
    data: { googleAuthError: reason.slice(0, 500) },
  });
  log.error("google", "auth_revoked", { hostId: host.id, reason });

  const { sendGoogleDisconnectedAlert } = await import("./alerts");
  await sendGoogleDisconnectedAlert(host, reason);
}

/** Busy blocks on the host calendar. Throws on failure — callers must fail closed. */
export async function freeBusy(
  host: Host,
  timeMin: Date,
  timeMax: Date
): Promise<BusyInterval[]> {
  const calendar = await calendarClient(host);
  const calendarId = host.googleCalendarId || "primary";

  try {
    const res = await calendar.freebusy.query({
      requestBody: {
        timeMin: timeMin.toISOString(),
        timeMax: timeMax.toISOString(),
        items: [{ id: calendarId }],
      },
    });

    const cal = res.data.calendars?.[calendarId];
    if (cal?.errors?.length) {
      throw new GoogleApiError(
        `freebusy: ${cal.errors.map((e) => e.reason).join(", ")}`
      );
    }
    return (cal?.busy ?? [])
      .filter((b) => b.start && b.end)
      .map((b) => ({ start: new Date(b.start!), end: new Date(b.end!) }));
  } catch (err) {
    if (err instanceof GoogleApiError || err instanceof GoogleAuthError) throw err;
    if (isAuthFailure(err)) {
      await markGoogleDisconnected(host, errorMessage(err));
      throw new GoogleAuthError("Google Calendar authorization has expired.");
    }
    throw new GoogleApiError(`freebusy failed: ${errorMessage(err)}`);
  }
}

export type CreatedEvent = { eventId: string; meetLink: string | null; htmlLink: string | null };

export async function createEvent(
  host: Host,
  args: {
    bookingId: string;
    summary: string;
    description: string;
    startTime: Date;
    endTime: Date;
    attendeeEmail: string;
    attendeeName: string;
  }
): Promise<CreatedEvent> {
  const calendar = await calendarClient(host);

  try {
    const res = await calendar.events.insert({
      calendarId: host.googleCalendarId || "primary",
      conferenceDataVersion: 1,
      sendUpdates: "all", // Google's own invite email is the primary confirmation channel
      requestBody: {
        summary: args.summary,
        description: args.description,
        start: { dateTime: args.startTime.toISOString(), timeZone: "UTC" },
        end: { dateTime: args.endTime.toISOString(), timeZone: "UTC" },
        attendees: [{ email: args.attendeeEmail, displayName: args.attendeeName }],
        guestsCanModify: false,
        conferenceData: {
          createRequest: {
            requestId: `bookkit-${args.bookingId}`,
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        extendedProperties: { private: { bookkitBookingId: args.bookingId } },
      },
    });

    const data = res.data;
    if (!data.id) throw new GoogleApiError("Calendar returned no event id");

    const meetLink =
      data.hangoutLink ??
      data.conferenceData?.entryPoints?.find((e) => e.entryPointType === "video")?.uri ??
      null;

    return { eventId: data.id, meetLink, htmlLink: data.htmlLink ?? null };
  } catch (err) {
    if (isAuthFailure(err)) {
      await markGoogleDisconnected(host, errorMessage(err));
      throw new GoogleAuthError("Google Calendar authorization has expired.");
    }
    throw new GoogleApiError(`event insert failed: ${errorMessage(err)}`);
  }
}

export async function deleteEvent(host: Host, eventId: string): Promise<void> {
  const calendar = await calendarClient(host);
  try {
    await calendar.events.delete({
      calendarId: host.googleCalendarId || "primary",
      eventId,
      sendUpdates: "all",
    });
  } catch (err) {
    const code = (err as { code?: number })?.code;
    // Already gone is success for our purposes.
    if (code === 404 || code === 410) return;
    if (isAuthFailure(err)) {
      await markGoogleDisconnected(host, errorMessage(err));
      throw new GoogleAuthError("Google Calendar authorization has expired.");
    }
    throw new GoogleApiError(`event delete failed: ${errorMessage(err)}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Create with bounded retry. Auth failures are terminal (retrying cannot help);
 * transient errors back off 1s / 2s / 4s.
 */
export async function createEventWithRetry(
  host: Host,
  args: Parameters<typeof createEvent>[1],
  maxAttempts = 3
): Promise<CreatedEvent> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await createEvent(host, args);
    } catch (err) {
      lastErr = err;
      if (err instanceof GoogleAuthError) throw err;
      log.warn("google", "event_insert_retry", {
        bookingId: args.bookingId,
        attempt,
        maxAttempts,
        error: errorMessage(err),
      });
      if (attempt < maxAttempts) await sleep(2 ** (attempt - 1) * 1000);
    }
  }
  throw lastErr instanceof Error ? lastErr : new GoogleApiError(String(lastErr));
}
