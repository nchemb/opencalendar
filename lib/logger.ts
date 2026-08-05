type Level = "info" | "warn" | "error";

/** Structured single-line JSON logs — greppable in Vercel's log viewer. */
function emit(level: Level, component: string, action: string, data?: Record<string, unknown>) {
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    component,
    action,
    ...(data ?? {}),
  });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (component: string, action: string, data?: Record<string, unknown>) =>
    emit("info", component, action, data),
  warn: (component: string, action: string, data?: Record<string, unknown>) =>
    emit("warn", component, action, data),
  error: (component: string, action: string, data?: Record<string, unknown>) =>
    emit("error", component, action, data),
};

export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
