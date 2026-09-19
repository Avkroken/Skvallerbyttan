import assert from "node:assert/strict";
import test from "node:test";
import {
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
