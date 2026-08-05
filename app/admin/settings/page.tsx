import { getHost } from "@/lib/booking";
import { appUrl, env, googleRedirectUri, hasGoogleOAuth, hasResend } from "@/lib/env";
import { allSettings } from "@/lib/settings";
import { stripeConfigured } from "@/lib/stripe";
import SettingsForm from "./SettingsForm";

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: { google?: string; detail?: string };
}) {
  const host = await getHost();
  const settings = await allSettings();

  const googleConnected = Boolean(host?.googleRefreshToken) && !host?.googleAuthError;

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
    { key: "ALERT_EMAIL", ok: Boolean(env("ALERT_EMAIL")), required: true },
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

        {searchParams.google === "connected" && (
          <p className="text-sm mb-3" style={{ color: "var(--bk-ok)" }}>
            Google Calendar connected.
          </p>
        )}
        {searchParams.google === "error" && (
          <p className="text-sm mb-3" style={{ color: "var(--bk-danger)" }}>
            {searchParams.detail || "Connection failed."}
          </p>
        )}
        {host?.googleAuthError && (
          <p className="text-sm mb-3" style={{ color: "var(--bk-danger)" }}>
            Last error: {host.googleAuthError}
          </p>
        )}

        <a
          className="bk-btn bk-btn-primary"
          href="/api/google/connect"
          aria-disabled={!hasGoogleOAuth()}
        >
          {googleConnected ? "Reconnect Google Calendar" : "Connect Google Calendar"}
        </a>

        {!hasGoogleOAuth() && (
          <p className="text-xs mt-3" style={{ color: "var(--bk-danger)" }}>
            Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET first.
          </p>
        )}
        <p className="text-xs text-[var(--bk-muted)] mt-3 break-all">
          Authorized redirect URI must be exactly: <code>{googleRedirectUri()}</code>
        </p>
      </section>

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-1">Stripe</h2>
        <p className="text-sm text-[var(--bk-muted)] mb-2">
          {stripeConfigured()
            ? `Secret key detected (${env("STRIPE_SECRET_KEY")?.startsWith("sk_live") ? "live" : "test"} mode).`
            : "No secret key — paid meeting types will refuse checkout."}
        </p>
        <p className="text-sm text-[var(--bk-muted)]">
          Webhook endpoint: <code className="break-all">{appUrl()}/api/stripe/webhook</code>
        </p>
        <p className="text-sm text-[var(--bk-muted)] mt-1">
          Events needed: <code>checkout.session.completed</code>, <code>checkout.session.expired</code>
          {env("STRIPE_WEBHOOK_SECRET") ? " — signing secret set." : " — signing secret MISSING."}
        </p>
      </section>

      <SettingsForm
        webhookUrl={settings.WEBHOOK_URL}
        webhookSecret={settings.WEBHOOK_SECRET}
        timezone={host?.timezone ?? "America/Chicago"}
        displayName={host?.displayName ?? ""}
        hasHost={Boolean(host)}
      />

      <section className="bk-card p-5">
        <h2 className="font-semibold mb-3">Environment</h2>
        <ul className="text-sm space-y-1.5">
          {checklist.map((c) => (
            <li key={c.key} className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{
                  background: c.ok
                    ? "var(--bk-ok)"
                    : c.required
                      ? "var(--bk-danger)"
                      : "var(--bk-muted)",
                }}
              />
              <code>{c.key}</code>
              <span className="text-[var(--bk-muted)]">
                {c.ok ? "set" : c.required ? "missing (required)" : "not set (optional)"}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
