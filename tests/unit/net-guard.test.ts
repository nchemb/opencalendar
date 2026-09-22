import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { assertPublicUrl, isPrivateAddress } from "../../lib/net-guard";
import { bookingsToCsv } from "../../lib/admin/csv";

afterEach(() => {
  delete process.env.ALLOW_PRIVATE_WEBHOOKS;
});

test("private, loopback, link-local, metadata and CGNAT addresses are private", () => {
  for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fd00::1", "fe80::1", "::ffff:10.0.0.1"]) {
    assert.equal(isPrivateAddress(ip), true, ip);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(ip), false, ip);
});

test("webhook URLs must be https and public", async () => {
  delete process.env.ALLOW_PRIVATE_WEBHOOKS;
  await assert.rejects(assertPublicUrl("http://8.8.8.8/hook"), /https/);
  await assert.rejects(assertPublicUrl("https://169.254.169.254/latest/meta-data"), /private/);
  await assert.rejects(assertPublicUrl("https://127.0.0.1:3000/x"), /private/);
  await assert.rejects(assertPublicUrl("https://[::1]/x"), /private/);
  assert.equal((await assertPublicUrl("https://8.8.8.8/hook")).hostname, "8.8.8.8");
});

test("CSV export neutralises spreadsheet formulas", () => {
  const csv = bookingsToCsv(
    [
      {
        id: "b1", name: '=HYPERLINK("http://evil","x")', email: "+1@x.io", status: "CONFIRMED",
        startTime: new Date("2026-09-23T15:00:00Z"), endTime: new Date("2026-09-23T15:30:00Z"),
        timezone: "UTC", amountCents: null, stripePaymentStatus: null, utm: { utm_source: "@ig" }, noShow: false,
        createdAt: new Date("2026-09-22T00:00:00Z"), meetingType: { name: "-x" },
      } as never,
    ],
    "UTC"
  );
  const row = csv.split("\n")[1];
  assert.ok(row.includes(`"'=HYPERLINK(""http://evil"",""x"")"`));
  assert.ok(row.includes("'+1@x.io"));
  assert.ok(row.includes("'@ig"));
  assert.ok(row.includes("'-x"));
});
