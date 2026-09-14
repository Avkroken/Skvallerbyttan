import assert from "node:assert/strict";
import test from "node:test";
import { securityEventFromWebhook, summarizeSecurityRows } from "../src/security-events";

test("extracts Dependabot package and lifecycle metadata without storing advisory text", () => {
  const record = securityEventFromWebhook(
    "delivery-1",
    "dependabot_alert",
    "Bastion",
    {
      action: "fixed",
      alert: {
        number: 12,
        dependency: { package: { ecosystem: "npm", name: "minimist" } },
        security_advisory: { severity: "high", ghsa_id: "GHSA-test" },
      },
    },
    "2026-09-14T12:00:00.000Z",
  );

  assert.deepEqual(record, {
    deliveryId: "delivery-1",
    event: "dependabot_alert",
    repo: "Bastion",
    alertNumber: 12,
    action: "fixed",
    severity: "high",
    subject: "npm:minimist",
    resolution: null,
    receivedAt: "2026-09-14T12:00:00.000Z",
  });
});

test("extracts code scanning and secret scanning metadata", () => {
  const code = securityEventFromWebhook("d2", "code_scanning_alert", "Skvallerbyttan", {
    action: "created",
    alert: { number: 3, rule: { id: "js/sql-injection", security_severity_level: "critical" } },
  });
  assert.equal(code?.subject, "js/sql-injection");
  assert.equal(code?.severity, "critical");

  const secret = securityEventFromWebhook("d3", "secret_scanning_alert", "Skvallerbyttan", {
    action: "resolved",
    alert: { number: 4, secret_type_display_name: "GitHub Personal Access Token", resolution: "revoked" },
  });
  assert.equal(secret?.subject, "GitHub Personal Access Token");
  assert.equal(secret?.resolution, "revoked");
});

test("summarizes security lifecycle and Dependabot patch rate", () => {
  const summary = summarizeSecurityRows([
    { repo: "A", event: "dependabot_alert", action: "created", count: 5 },
    { repo: "A", event: "dependabot_alert", action: "fixed", count: 3 },
    { repo: "A", event: "dependabot_alert", action: "dismissed", count: 1 },
    { repo: "A", event: "dependabot_alert", action: "reintroduced", count: 1 },
    { repo: "A", event: "code_scanning_alert", action: "created", count: 2 },
    { repo: "A", event: "code_scanning_alert", action: "fixed", count: 1 },
    { repo: "A", event: "secret_scanning_alert", action: "created", count: 1 },
    { repo: "A", event: "secret_scanning_alert", action: "resolved", count: 1 },
  ]);

  assert.equal(summary.discovered, 8);
  assert.equal(summary.remediated, 5);
  assert.equal(summary.dismissed, 1);
  assert.equal(summary.reopened, 1);
  assert.equal(summary.dependabot.patchRateClosed, 0.75);
  assert.equal(summary.dependabot.reintroduced, 1);
});

test("ignores unrelated webhook events", () => {
  assert.equal(securityEventFromWebhook("d4", "push", "Bastion", { action: "created" }), null);
});
