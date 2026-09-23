/** "Send test" button on a webhook endpoint: one signed synchronous delivery, not via the outbox. */
import { prisma } from "../db";
import { sign } from "../webhooks";
import { assertPublicUrl } from "../net-guard";

export async function sendTestWebhook(endpointId: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const ep = await prisma.webhookEndpoint.findUniqueOrThrow({ where: { id: endpointId } });
  const body = JSON.stringify({ event: "ping", createdAt: new Date().toISOString(), data: { message: "Test delivery from OpenCalendar admin." } });
  try {
    await assertPublicUrl(ep.url);
    const res = await fetch(ep.url, {
      redirect: "manual",
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "BookKit-Webhooks/2",
        "BookKit-Signature": sign(ep.secret, body),
      },
      body,
      signal: AbortSignal.timeout(10_000),
    });
    await prisma.webhookEndpoint.update({
      where: { id: endpointId },
      data: { lastStatus: res.status, ...(res.ok ? { lastDeliveredAt: new Date() } : {}) },
    });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
