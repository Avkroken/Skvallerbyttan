import assert from "node:assert/strict";
import test from "node:test";
import {
  casbEventFromPayload,
  notificationEventFromPayload,
  secureEqual,
} from "../src/cloudflare-webhook";

test("compares webhook secrets without accepting length or value mismatches", () => {
  assert.equal(secureEqual("same-secret", "same-secret"), true);
  assert.equal(secureEqual("same-secret", "same-secreu"), false);
  assert.equal(secureEqual("short", "longer"), false);
  assert.equal(secureEqual(null, "secret"), false);
});

test("normalizes Cloudflare Notifications without persisting alert body or arbitrary data", () => {
  const event = notificationEventFromPayload({
    account_id: "account",
    policy_id: "policy",
    policy_name: "Origin errors",
    alert_type: "http_alert_origin_error",
    alert_correlation_id: "correlation",
    alert_event: "ALERT_STATE_EVENT_START",
    ts: 1_700_000_000,
    text: "sensitive rendered description",
    data: { secret: "must-not-be-copied" },
  }, "delivery", "2026-09-19T05:00:00.000Z");

  assert.deepEqual(event, {
    deliveryId: "delivery",
    source: "notifications",
    eventType: "http_alert_origin_error",
    eventId: "correlation",
    state: "ALERT_STATE_EVENT_START",
    accountId: "account",
    policyId: "policy",
    summary: "Origin errors",
    occurredAt: "2023-11-14T22:13:20.000Z",
    receivedAt: "2026-09-19T05:00:00.000Z",
  });
  assert.equal("data" in event, false);
  assert.equal("text" in event, false);
});

test("normalizes CASB findings to top-level identifiers only", () => {
  const event = casbEventFromPayload({
    id: "finding-id",
    type: "posture_finding",
    metadata: { actor: "sensitive" },
    data: { asset: "sensitive" },
  }, "delivery", "2026-09-19T05:00:00.000Z");

  assert.deepEqual(event, {
    deliveryId: "delivery",
    source: "casb",
    eventType: "posture_finding",
    eventId: "finding-id",
    state: null,
    accountId: null,
    policyId: null,
    summary: null,
    occurredAt: null,
    receivedAt: "2026-09-19T05:00:00.000Z",
  });
});
