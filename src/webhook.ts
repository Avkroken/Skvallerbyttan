import { organization, resolveSecretValue, type Env } from "./env";
import { recordSecurityEvent, securityEventFromWebhook } from "./security-events";
import { activityFromGitHubWebhook, recordObservedActivity } from "./activity";
import {
  invalidateSourceCache,
  recordWebhookDelivery,
  sourceCacheConfigured,
} from "./source-cache";

const encoder = new TextEncoder();
const SIGNATURE_PREFIX = "sha256=";

const GOVERNANCE_EVENTS = new Set([
  "branch_protection_rule",
  "repository",
  "repository_ruleset",
]);

const INVALIDATING_EVENTS = new Set([
  "branch_protection_rule",
  "check_run",
  "check_suite",
  "code_scanning_alert",
  "create",
  "delete",
  "dependabot_alert",
  "deployment",
  "deployment_status",
  "fork",
  "issues",
  "pull_request",
  "pull_request_review",
  "pull_request_review_comment",
  "push",
  "release",
  "repository",
  "repository_ruleset",
  "secret_scanning_alert",
  "secret_scanning_alert_location",
  "star",
  "status",
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

export async function verifyWebhookSignature(body: string, signature: string | null, secret: string): Promise<boolean> {
  if (!signature?.startsWith(SIGNATURE_PREFIX) || !secret) return false;
  const provided = bytesFromHex(signature.slice(SIGNATURE_PREFIX.length));
  if (!provided) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, provided, encoder.encode(body));
}

export function webhookCacheKeys(event: string, repo: string | null): string[] {
  if (!INVALIDATING_EVENTS.has(event)) return [];
  const keys = ["overview"];
  if (repo) keys.push(`repository:${repo}`, `insights:${repo}`);
  if (GOVERNANCE_EVENTS.has(event)) {
    keys.push("github:org:governance");
    if (repo) keys.push(`github:repo:${repo}:effective-policy`);
  }
  return keys;
}

function repoFromPayload(payload: WebhookPayload): string | null {
  const name = payload.repository?.name?.trim();
  return name && /^[A-Za-z0-9_.-]+$/.test(name) ? name : null;
}

function ownerFromPayload(payload: WebhookPayload): string | null {
  return payload.organization?.login?.trim() || payload.repository?.owner?.login?.trim() || null;
}

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

export async function handleGitHubWebhook(request: Request, env: Env): Promise<Response> {
  if (request.method !== "POST") {
    const result = response({ error: "method not allowed" }, 405);
    result.headers.set("Allow", "POST");
    return result;
  }

  const secret = await resolveSecretValue(env.SKVALLERBYTTAN_GITHUB_WEBHOOK_SECRET);
  if (!secret || !sourceCacheConfigured(env)) return response({ error: "webhook not configured" }, 503);

  const body = await request.text();
  const signature = request.headers.get("x-hub-signature-256");
  if (!(await verifyWebhookSignature(body, signature, secret))) {
    return response({ error: "invalid webhook signature" }, 401);
  }

  const event = request.headers.get("x-github-event")?.trim() || "";
  const deliveryId = request.headers.get("x-github-delivery")?.trim() || "";
  if (!event || !deliveryId) return response({ error: "missing webhook headers" }, 400);

  let payload: WebhookPayload;
  try {
    payload = JSON.parse(body) as WebhookPayload;
  } catch {
    return response({ error: "invalid webhook payload" }, 400);
  }

  const repo = repoFromPayload(payload);
  const owner = ownerFromPayload(payload);
  if (owner && owner.toLowerCase() !== organization(env).toLowerCase()) {
    return response({ ok: true, ignored: "different organization" }, 202);
  }

  const isNew = await recordWebhookDelivery(env, deliveryId, event, repo);
  if (!isNew) return response({ ok: true, duplicate: true }, 202);

  const observedActivity = activityFromGitHubWebhook(
    deliveryId,
    event,
    repo,
    payload as unknown as Record<string, unknown>,
  );
  const activityRecorded = await recordObservedActivity(env, observedActivity);

  const securityRecord = securityEventFromWebhook(deliveryId, event, repo, payload);
  let securityRecorded = false;
  if (securityRecord) {
    try {
      await recordSecurityEvent(env, securityRecord);
      securityRecorded = true;
    } catch (error) {
      console.error("security event ledger write failed", {
        event,
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const keys = webhookCacheKeys(event, repo);
  if (keys.length > 0) await invalidateSourceCache(env, keys, `github:${event}`);

  return response({
    ok: true,
    event,
    repo,
    invalidated: keys.length,
    activityRecorded,
    ...(securityRecord ? { securityRecorded } : {}),
  }, 202);
}
