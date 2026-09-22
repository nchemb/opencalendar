import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { openToken, sealToken } from "../../lib/secrets";
import { fakeCalendarInProduction } from "../../lib/env";

const KEY = Buffer.alloc(32, 7).toString("base64");
afterEach(() => {
  delete process.env.TOKEN_ENCRYPTION_KEY;
});

test("tokens round-trip when a key is set, and are not stored in the clear", () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  const sealed = sealToken("1//refresh-token")!;
  assert.ok(sealed.startsWith("enc:v1:"));
  assert.ok(!sealed.includes("refresh-token"));
  assert.equal(openToken(sealed), "1//refresh-token");
  assert.notEqual(sealToken("1//refresh-token"), sealed); // fresh IV each time
});

test("without a key tokens pass through, and legacy plaintext still reads with a key", () => {
  assert.equal(sealToken("plain"), "plain");
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  assert.equal(openToken("plain"), "plain");
});

test("tampered ciphertext fails instead of returning garbage", () => {
  process.env.TOKEN_ENCRYPTION_KEY = KEY;
  const sealed = sealToken("secret")!;
  const bad = sealed.slice(0, -2) + (sealed.endsWith("A") ? "BB" : "AA");
  assert.throws(() => openToken(bad));
});

test("the in-memory calendar on a production deploy is flagged", () => {
  const prev = { ...process.env };
  Object.assign(process.env, { NODE_ENV: "production", BOOKKIT_CALENDAR: "memory" });
  delete process.env.BOOKKIT_DEMO_MODE;
  try {
    assert.equal(fakeCalendarInProduction(), true);
    process.env.BOOKKIT_DEMO_MODE = "1";
    assert.equal(fakeCalendarInProduction(), false);
  } finally {
    process.env = prev;
  }
});
