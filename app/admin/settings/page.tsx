import { getHost } from "@/lib/booking";
import { appUrl, env, googleRedirectUri, hasGoogleOAuth, hasResend } from "@/lib/env";
import { stripeConfigured, stripeKeyMismatch } from "@/lib/stripe";
import { lastTickAt } from "@/lib/cron";
import { calendar } from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { WEBHOOK_EVENTS } from "@/lib/webhooks";
import HostProfileForm from "./HostProfileForm";
import CalendarSelect from "./CalendarSelect";
import AlertChannels from "./AlertChannels";
import WebhookEndpoints from "./WebhookEndpoints";
import ApiKeys from "./ApiKeys";
import DataPrivacy from "./DataPrivacy";

export const dynamic = "force-dynamic";

export default async function SettingsPage({ searchParams }: { searchParams: { google?: string; detail?: string } }) {
  const host = await getHost();
  const googleConnected = Boolean(host?.googleRefreshToken) && !host?.googleAuthError;

  let calendars: { id: string; summary: string; primary: boolean }[] = [];
  let calendarsError: string | null = null;
  if (host) {
    try {
      calendars = await calendar().listCalendars(host);
    } catch (err) {
      calendarsError = err instanceof Error ? err.message : String(err);
    }
  }

  const [webhookRows, apiKeyRows] = await Promise.all([
    prisma.webhookEndpoint.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.apiKey.findMany({ orderBy: { createdAt: "desc" } }),
  ]);

  const tickAt = await lastTickAt();
  const cronUrl = `${appUrl()}/api/cron/tick?secret=${env("CRON_SECRET") ? "***" : "<CRON_SECRET>"}`;

  const checklist = [
    { key: "DATABASE_URL", ok: Boolean(env("DATABASE_URL")), required: true },
    { key: "ADMIN_PASSWORD", ok: Boolean(env("ADMIN_PASSWORD")), required: true },
    { key: "ADMIN_EMAIL", ok: Boolean(env("ADMIN_EMAIL")), required: true },
    { key: "GOOGLE_CLIENT_ID / SECRET", ok: hasGoogleOAuth(), required: true },
    { key: "GOOGLE_REDIRECT_URI", ok: Boolean(env("GOOGLE_REDIRECT_URI")), required: false },
    { key: "STRIPE_SECRET_KEY", ok: stripeConfigured(), required: false },
    { key: "STRIPE_WEBHOOK_SECRET", ok: Boolean(env("STRIPE_WEBHOOK_SECRET")), required: false },
    { key: "RESEND_API_KEY", ok: hasResend(), required: false },
    { key: "RESEND_FROM", ok: Boolean(env("RESEND_FROM")), required: false },
    { key: "ALERT_EMAIL", ok: Boolean(env("ALERT_EMAIL")), required: false },
    { key: "ALERT_WEBHOOK_URL", ok: Boolean(env("ALERT_WEBHOOK_URL")), required: false },
    { key: "CRON_SECRET", ok: Boolean(env("CRON_SECRET")), required: false },
    { key: "NEXT_PUBLIC_APP_URL", ok: Boolean(env("NEXT_PUBLIC_APP_URL")), required: false },
  ];

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-semibold">Settings</h1>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Google Calendar</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-4">
          {googleConnected
            ? `Connected as ${host?.email} — reading freebusy and writing events with Meet links.`
            : "Not connected. Availability and bookings stay closed until this is done."}
        </p>

        {searchParams.google === "connected" && <p className="text-sm mb-3" style={{ color: "var(--bk-ok)" }}>Google Calendar connected.</p>}
        {searchParams.google === "error" && <p className="text-sm mb-3" style={{ color: "var(--bk-danger)" }}>{searchParams.detail || "Connection failed."}</p>}
        {host?.googleAuthError && <p className="text-sm mb-3" style={{ color: "var(--bk-danger)" }}>Last error: {host.googleAuthError}</p>}

        <a className="bk-btn bk-btn-primary" href="/api/google/connect" aria-disabled={!hasGoogleOAuth()}>
          {googleConnected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
        </a>

        {!hasGoogleOAuth() && <p className="text-xs mt-3" style={{ color: "var(--bk-danger)" }}>Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.</p>}
        <p className="text-xs text-[var(--bk-muted)] mt-3 break-all">
          Authorized redirect URI must be exactly: <code>{googleRedirectUri()}</code>
        </p>

        {calendarsError && <p className="text-sm mt-3" style={{ color: "var(--bk-danger)" }}>Could not list calendars: {calendarsError}</p>}
        {host && calendars.length > 0 && (
          <div className="mt-4 pt-4 border-t border-[var(--bk-border)]">
            <CalendarSelect calendars={calendars} destination={host.googleCalendarId} conflictIds={host.conflictCalendarIds} />
          </div>
        )}
      </section>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Stripe</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-2">
          {stripeConfigured() ? `Secret key detected (${env("STRIPE_SECRET_KEY")?.startsWith("sk_live") ? "live" : "test"} mode).` : "No secret key — paid meeting types will refuse checkout."}
        </p>
        <p className="text-sm text-[var(--bk-muted)]">
          Webhook endpoint: <code className="break-all">{appUrl()}/api/stripe/webhook</code>
        </p>
        <p className="text-sm text-[var(--bk-muted)] mt-1">
          Events needed: <code>checkout.session.completed</code>, <code>checkout.session.expired</code>, <code>payment_intent.succeeded</code>
          {env("STRIPE_WEBHOOK_SECRET") ? " — signing secret set." : " — signing secret MISSING."}
        </p>
        {stripeKeyMismatch() && <p className="text-sm mt-2" style={{ color: "var(--bk-danger)" }}>{stripeKeyMismatch()}</p>}
      </section>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Email</h2>
        <p className="text-sm text-[var(--bk-muted)]">
          {hasResend() && env("RESEND_FROM")
            ? `Configured — sending as ${env("RESEND_FROM")}.`
            : "Not fully configured. Set RESEND_API_KEY and RESEND_FROM, or invitees get no confirmation/reminder emails from OpenCalendar (Google's own invite still sends)."}
        </p>
      </section>

      <AlertChannels alertEmailSet={Boolean(env("ALERT_EMAIL"))} alertWebhookSet={Boolean(env("ALERT_WEBHOOK_URL"))} hostEmail={host?.email ?? null} />

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Cron</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-2">
          {tickAt ? `Last tick ${Math.round((Date.now() - tickAt) / 60_000)} min ago.` : "Never ran — schedule the URL below."}
        </p>
        <p className="text-sm text-[var(--bk-muted)]">
          Schedule a request every 1–5 minutes to: <code className="break-all">{cronUrl}</code> (or send header{" "}
          <code>Authorization: Bearer $CRON_SECRET</code>).
        </p>
      </section>

      {host && (
        <section className="bk-card p-5">
          <h2 className="font-semibold mb-3">Host profile</h2>
          <HostProfileForm timezone={host.timezone} displayName={host.displayName ?? ""} avatarUrl={host.avatarUrl ?? ""} />
        </section>
      )}

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Webhook endpoints</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-4">Signed HMAC-SHA256 deliveries on booking events, with retries. The last delivery status shows on each endpoint.</p>
        <WebhookEndpoints
          endpoints={webhookRows.map((w) => ({ id: w.id, url: w.url, events: w.events, active: w.active, lastStatus: w.lastStatus, lastDeliveredAt: w.lastDeliveredAt?.toISOString() ?? null }))}
          allEvents={WEBHOOK_EVENTS}
        />
      </section>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">API keys</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-4">For the REST API and MCP server. The key is shown once, at creation.</p>
        <ApiKeys keys={apiKeyRows.map((k) => ({ id: k.id, name: k.name, prefix: k.prefix, lastUsedAt: k.lastUsedAt?.toISOString() ?? null, revokedAt: k.revokedAt?.toISOString() ?? null }))} />
      </section>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Data</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-4">Delete or export everything OpenCalendar stored for one invitee email. Google calendar events are left untouched.</p>
        <DataPrivacy />
      </section>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-3">Environment</h2>
        <ul className="text-sm space-y-1.5">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: c.ok ? "var(--bk-ok)" : c.required ? "var(--bk-danger)" : "var(--bk-muted)" }} />
              <code>{c.key}</code>
              <span className="text-[var(--bk-muted)]">{c.ok ? "set" : c.required ? "missing (required)" : "not set (optional)"}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
