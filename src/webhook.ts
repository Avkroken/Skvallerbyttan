import type { Env } from "./env";
import { organization } from "./env";
import { invalidateSourceCache, recordWebhookDelivery } from "./source-cache";

const encoder = new TextEncoder();
const SIGNATURE_PREFIX = "sha256=";

const INVALIDATING_EVENTS = new Set([
  "check_run",
  "check_suite",
  "code_scanning_alert",
  "create",
  "delete",
  "dependabot_alert",
  "deployment",
  "deployment_status",
  "pull_request",
  "pull_request_review",
  "push",
  "release",
  "repository",
  "repository_ruleset",
  "secret_scanning_alert",
  "workflow_job",
  "workflow_run",
]);

type WebhookPayload = {
  organization?: { login?: string | null } | null;
  repository?: { name?: string | null; owner?: { login?: string | null } | null } | null;
};

function bytesFromHex(value: string): Uint8Array | null {
  if (value.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(value)) return null;
  const bytes = new Uint8Array(value.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let mismatch = 0;
  for (let index = 0; index < left.length; index += 1) mismatch |= left[index] ^ right[index];
  return mismatch === 0;
}

export async function verifyWebhookSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature?.startsWith(SIGNATURE_PREFIX) || !secret) return false;
  const provided = bytesFromHex(signature.slice(SIGNATURE_PREFIX.length));
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body)));
  return constantTimeEqual(expected, provided);
}

export function webhookCacheKeys(event: string, repo: string | null): string[] {
  if (!INVALIDATING_EVENTS.has(event)) return [];
  if (!repo) return ["overview"];
  return ["overview", `repository:${repo}`, `insights:${repo}`];
}

function repoFromPayload(payload: WebhookPayload): string | null {
  const name = payload.repository?.name?.trim();
  return name && /^[A-Za-z0-9_.-]+$/.test(name) ? name : null;
}

function ownerFromPayload(payload: WebhookPayload): string | null {
  return payload.organization?.login?.trim() || payload.repository?.owner?.login?.trim() || null;
}

export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { "content-type": "application/json; charset=utf-8", Allow: "POST" },
    });
  }

  const secret = env.SKVALLERBYTTAN_WEBHOOK_SECRET?.trim();
  if (!secret) {
    return new Response(JSON.stringify({ error: "webhook not configured" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!(await verifyWebhookSignature(body, signature, secret))) {
    return new Response(JSON.stringify({ error: "invalid webhook signature" }), {
      status: 401,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const event = request.headers.get("x-github-event")?.trim() || "";
  const deliveryId = request.headers.get("x-github-delivery")?.trim() || "";
  if (!event || !deliveryId) {
    return new Response(JSON.stringify({ error: "missing webhook headers" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    return new Response(JSON.stringify({ error: "invalid webhook payload" }), {
      status: 400,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  }

  const repo = repoFromPayload(payload);
  const owner = ownerFromPayload(payload);
  if (owner && owner.toLowerCase() !== organization(env).toLowerCase()) {
    return new Response(JSON.stringify({ ok: true, ignored: "different organization" }), {
      status: 202,
      headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const isNew = await recordWebhookDelivery(env, deliveryId, event, repo);
  if (!isNew) {
    return new Response(JSON.stringify({ ok: true, duplicate: true }), {
      status: 202,
      headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const keys = webhookCacheKeys(event, repo);
  if (keys.length > 0) await invalidateSourceCache(env, keys, `github:${event}`);

  return new Response(JSON.stringify({ ok: true, event, repo, invalidated: keys.length }), {
    status: 202,
    headers: { "content-type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
