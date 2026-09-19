import type { Env } from "./env";
import { recordCloudflareEvent, type CloudflareEventRecord } from "./cloudflare-events";
import {
  activityFromCloudflareWebhook,
  recordObservedActivity,
} from "./activity";
import {
  invalidateSourceCache,
  recordWebhookDelivery,
  sourceCacheConfigured,
} from "./source-cache";

const encoder = new TextEncoder();
export const CASB_AUTH_HEADER = "x-skvallerbyttan-casb-auth";

function response(value: unknown, status: number): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function clipped(value: unknown, max = 200): string | null {
  const result = text(value);
  return result ? result.slice(0, max) : null;
}

function isoFromUnixSeconds(value: unknown): string | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const date = new Date(value * 1000);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export function secureEqual(left: string | null, right: string): boolean {
  if (!left || !right) return false;
  const a = encoder.encode(left);
  const b = encoder.encode(right);
  const max = Math.max(a.length, b.length);
  let mismatch = a.length ^ b.length;
  for (let index = 0; index < max; index += 1) {
    mismatch |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return mismatch === 0;
}

async function sha256(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  return [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function deliveryId(prefix: string, explicitId: string | null, body: string): Promise<string> {
  if (explicitId) return `${prefix}:${explicitId}`;
  return `${prefix}:sha256:${await sha256(body)}`;
}

export function notificationEventFromPayload(
  payload: Record<string, unknown>,
  deliveryIdValue: string,
  receivedAt = new Date().toISOString(),
): CloudflareEventRecord {
  const eventType = clipped(payload.alert_type, 160) || "notification";
  const correlationId = clipped(payload.alert_correlation_id, 160);
  return {
    deliveryId: deliveryIdValue,
    source: "notifications",
    eventType,
    eventId: correlationId,
    state: clipped(payload.alert_event, 160),
    accountId: clipped(payload.account_id, 80),
    policyId: clipped(payload.policy_id, 80),
    summary: clipped(payload.policy_name, 200) || clipped(payload.name, 200),
    occurredAt: isoFromUnixSeconds(payload.ts),
    receivedAt,
  };
}

export function casbEventFromPayload(
  payload: Record<string, unknown>,
  deliveryIdValue: string,
  receivedAt = new Date().toISOString(),
): CloudflareEventRecord {
  return {
    deliveryId: deliveryIdValue,
    source: "casb",
    eventType: clipped(payload.type, 160) || "posture_finding",
    eventId: clipped(payload.id, 160),
    state: null,
    accountId: null,
    policyId: null,
    summary: null,
    occurredAt: null,
    receivedAt,
  };
}

function notificationExplicitDeliveryId(payload: Record<string, unknown>): string | null {
  const correlation = clipped(payload.alert_correlation_id, 160);
  const event = clipped(payload.alert_event, 160);
  const timestamp = typeof payload.ts === "number" && Number.isFinite(payload.ts) ? String(payload.ts) : null;
  return correlation && event ? [correlation, event, timestamp].filter(Boolean).join(":") : null;
}

export async function handleCloudflareNotificationsWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    const result = response({ error: "method not allowed" }, 405);
    result.headers.set("Allow", "POST");
    return result;
  }

  const secret = env.CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET?.trim() || "";
  if (!secret || !sourceCacheConfigured(env)) return response({ error: "webhook not configured" }, 503);
  if (!secureEqual(request.headers.get("cf-webhook-auth"), secret)) {
    return response({ error: "invalid webhook authentication" }, 401);
  }

  const body = await request.text();
  let payload: Record<string, unknown>;
  try {
    const parsed = record(JSON.parse(body));
    if (!parsed) return response({ error: "invalid webhook payload" }, 400);
    payload = parsed;
  } catch {
    return response({ error: "invalid webhook payload" }, 400);
  }

  const id = await deliveryId("cloudflare-notifications", notificationExplicitDeliveryId(payload), body);
  const event = notificationEventFromPayload(payload, id);
  const isNew = await recordWebhookDelivery(env, id, `cloudflare:${event.source}:${event.eventType}`, null);
  if (!isNew) return response({ ok: true, duplicate: true }, 202);

  await recordCloudflareEvent(env, event);
  await recordObservedActivity(env, activityFromCloudflareWebhook(event));
  await invalidateSourceCache(
    env,
    ["cloudflare:notifications:history"],
    `cloudflare:notifications:${event.eventType}`,
  );

  return response({ ok: true, source: event.source, eventType: event.eventType }, 202);
}

export async function handleCloudflareCasbWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    const result = response({ error: "method not allowed" }, 405);
    result.headers.set("Allow", "POST");
    return result;
  }

  const secret = env.CLOUDFLARE_CASB_WEBHOOK_SECRET?.trim() || "";
  if (!secret || !sourceCacheConfigured(env)) return response({ error: "webhook not configured" }, 503);
  if (!secureEqual(request.headers.get(CASB_AUTH_HEADER), secret)) {
    return response({ error: "invalid webhook authentication" }, 401);
  }

  const body = await request.text();
  let payload: Record<string, unknown>;
  try {
    const parsed = record(JSON.parse(body));
    if (!parsed) return response({ error: "invalid webhook payload" }, 400);
    payload = parsed;
  } catch {
    return response({ error: "invalid webhook payload" }, 400);
  }

  const id = await deliveryId("cloudflare-casb", clipped(payload.id, 160), body);
  const event = casbEventFromPayload(payload, id);
  const isNew = await recordWebhookDelivery(env, id, `cloudflare:${event.source}:${event.eventType}`, null);
  if (!isNew) return response({ ok: true, duplicate: true }, 202);

  await recordCloudflareEvent(env, event);
  await recordObservedActivity(env, activityFromCloudflareWebhook(event));
  return response({ ok: true, source: event.source, eventType: event.eventType }, 202);
}
