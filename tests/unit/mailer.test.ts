import { beforeEach, expect, test, vi } from "vitest";

const send = vi.fn();
vi.mock("resend", () => ({ Resend: vi.fn(() => ({ emails: { send } })) }));

import { sendMail } from "../../lib/mailer";

const mail = { to: "a@example.test", subject: "Hi", html: "<p>x</p>", text: "x", idempotencyKey: "job:1" };

beforeEach(() => {
  send.mockReset();
  process.env.RESEND_API_KEY = "re_test_fake";
  process.env.RESEND_FROM = "BookKit <bookings@example.test>";
});

test("passes the job's idempotency key to Resend", async () => {
  send.mockResolvedValue({ data: { id: "em_1" }, error: null });
  expect(await sendMail(mail)).toBe(true);
  expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: "job:1" });
});

test("a retry whose body changed counts as already sent, not a failure", async () => {
  send.mockResolvedValue({ data: null, error: { name: "invalid_idempotent_request", message: "different payload" } });
  expect(await sendMail(mail)).toBe(true);
});

test("a concurrent retry is still a failure (the outbox tries again)", async () => {
  send.mockResolvedValue({ data: null, error: { name: "concurrent_idempotent_requests", message: "in flight" } });
  expect(await sendMail(mail)).toBe(false);
});
