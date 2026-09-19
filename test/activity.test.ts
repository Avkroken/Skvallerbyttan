import assert from "node:assert/strict";
import test from "node:test";
import {
  activityFromCloudflareAudit,
  activityFromCloudflareWebhook,
  activityFromGitHubWebhook,
} from "../src/activity";

test("GitHub webhook activity is normalized without retaining raw payload", () => {
  const event = activityFromGitHubWebhook(
    "delivery-1",
    "workflow_run",
    "Skvallerbyttan",
    {
      action: "completed",
      workflow_run: { id: 42, conclusion: "failure", head_repository: { private: true } },
      installation: { id: 999 },
    },
    "2026-09-19T08:00:00.000Z",
  );

  assert.equal(event.capability, "github.avkroken.actions");
  assert.equal(event.resourceId, "42");
  assert.equal(event.action, "completed");
  assert.equal(event.coverage, "since_first_observation");
  assert.equal(JSON.stringify(event).includes("installation"), false);
});

test("Cloudflare webhook activity keeps observed count semantics explicit", () => {
  const event = activityFromCloudflareWebhook({
    deliveryId: "cf-1",
    source: "notifications",
    eventType: "workers_alert",
    eventId: "event-1",
    state: "triggered",
    occurredAt: "2026-09-19T08:00:00.000Z",
    receivedAt: "2026-09-19T08:00:01.000Z",
  });
  assert.equal(event.capability, "cloudflare.avkroken.notifications");
  assert.equal(event.coverage, "since_first_observation");
  assert.equal(event.source, "webhook");
});


test("Cloudflare audit activity is classified without raw audit payloads", () => {
  const event = activityFromCloudflareAudit({
    id: "audit-42",
    action: { type: "update", result: "success", time: "2026-09-19T08:00:00Z" },
    resource: { id: "worker-a", type: "script", product: "Workers", request: { secret: "no" } },
    actor: { token_id: "hidden" },
  });
  assert.equal(event?.capability, "cloudflare.avkroken.workers");
  assert.equal(event?.source, "audit_log");
  assert.equal(event?.coverage, "partial");
  assert.equal(JSON.stringify(event).includes("hidden"), false);
});


test("Cloudflare audit classification maps storage and Zero Trust resources to specific capabilities", () => {
  const cases = [
    [{ id: "a-d1", action: { type: "update" }, resource: { id: "db", type: "d1_database", product: "D1" } }, "cloudflare.avkroken.storage.d1"],
    [{ id: "a-kv", action: { type: "update" }, resource: { id: "ns", type: "kv_namespace", product: "Workers KV" } }, "cloudflare.avkroken.storage.kv"],
    [{ id: "a-r2", action: { type: "update" }, resource: { id: "bucket", type: "r2_bucket", product: "R2" } }, "cloudflare.avkroken.storage.r2"],
    [{ id: "a-access", action: { type: "update" }, resource: { id: "app", type: "access_application", product: "Access" } }, "cloudflare.avkroken.zero_trust.access"],
    [{ id: "a-tunnel", action: { type: "update" }, resource: { id: "tun", type: "tunnel", product: "Cloudflare Tunnel" } }, "cloudflare.avkroken.zero_trust.tunnels"],
  ] as const;

  for (const [payload, capability] of cases) {
    assert.equal(activityFromCloudflareAudit(payload as any)?.capability, capability);
  }
});
