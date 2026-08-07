import { test as base } from "@playwright/test";

/**
 * Gives every test its own client IP.
 *
 * BookKit rate-limits public POSTs per IP (8 bookings a minute), and the whole
 * suite would otherwise arrive from 127.0.0.1 and trip it partway through.
 * clientIp() reads x-forwarded-for first, which is what a real deployment sits
 * behind anyway.
 */
let seq = 0;

export const test = base.extend({
  extraHTTPHeaders: async ({}, use: (headers: Record<string, string>) => Promise<void>) => {
    seq += 1;
    const ip = `10.${(seq >> 16) & 255}.${(seq >> 8) & 255}.${seq & 255}`;
    await use({ "x-forwarded-for": ip });
  },
});

export { expect } from "@playwright/test";
