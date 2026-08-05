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

export function formatPrice(cents: number, currency = "usd"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}
