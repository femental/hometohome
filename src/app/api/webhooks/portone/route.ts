import { payDeps } from "@/server/payments/deps";
import { portOneConfig } from "@/server/payments/portone";
import { handlePortOneWebhook } from "@/server/payments/service";

/**
 * PortOne V2 webhook. The signature is checked on the raw body; the payment itself is re-read from
 * the PG by `completePayment`, so the body is never trusted for amounts.
 */
export async function POST(request: Request): Promise<Response> {
  const secret = portOneConfig().webhookSecret;
  const deps = payDeps();
  if (!secret || !deps) return new Response("webhook not configured", { status: 503 });
  const status = await handlePortOneWebhook(deps, secret, await request.text(), request.headers);
  return new Response(null, { status });
}
