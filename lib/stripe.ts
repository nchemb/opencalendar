import Stripe from "stripe";
import { env } from "./env";

let client: Stripe | null = null;

export function stripe(): Stripe {
  const key = env("STRIPE_SECRET_KEY");
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set — paid meeting types are disabled.");
  if (!client) client = new Stripe(key, { apiVersion: "2026-02-25.clover" });
  return client;
}

export function stripeConfigured(): boolean {
  return Boolean(env("STRIPE_SECRET_KEY"));
}

function keyMode(key: string | undefined): "live" | "test" | null {
  if (!key) return null;
  if (key.includes("_live_")) return "live";
  if (key.includes("_test_")) return "test";
  return null;
}

/**
 * A test secret key paired with a live publishable key (or vice versa) makes the
 * card form fail with an opaque Stripe error. Catch it up front instead.
 */
export function stripeKeyMismatch(): string | null {
  const secret = keyMode(env("STRIPE_SECRET_KEY"));
  const publishable = keyMode(env("NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"));
  if (!secret || !publishable) return null;
  if (secret !== publishable) {
    return `STRIPE_SECRET_KEY is a ${secret}-mode key but NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is ${publishable}-mode — they must match.`;
  }
  return null;
}

export function formatPrice(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
