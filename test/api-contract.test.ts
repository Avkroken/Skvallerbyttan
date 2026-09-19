import assert from "node:assert/strict";
import test from "node:test";
import { CAPABILITY_DEFINITIONS } from "../src/capabilities";
import { OBSERVATION_STATUSES } from "../src/observation-model";
import { normalizeRuleset } from "../src/github-governance";

test("observation status contract is versioned by an explicit stable vocabulary", () => {
  assert.deepEqual(OBSERVATION_STATUSES, [
    "available",
    "unavailable",
    "permission_denied",
    "not_configured",
    "not_supported",
    "not_exposed_by_provider",
    "unknown",
    "not_observed",
    "stale",
    "error",
  ]);
});

test("capability keys are an explicit machine-consumed contract", () => {
  assert.deepEqual(CAPABILITY_DEFINITIONS.map((capability) => capability.key), [
    "github.avkroken.repositories",
    "github.avkroken.pull_requests",
    "github.avkroken.actions",
    "github.avkroken.organization.actions_permissions",
    "github.avkroken.organization.actions_policies",
    "github.avkroken.organization.rulesets",
    "github.avkroken.repositories.effective_rulesets",
    "github.avkroken.custom_properties",
    "github.avkroken.security",
    "github.avkroken.security_configurations",
    "cloudflare.avkroken.account",
    "cloudflare.avkroken.zones",
    "cloudflare.avkroken.workers",
    "cloudflare.avkroken.zero_trust",
    "cloudflare.avkroken.notifications",
    "cloudflare.avkroken.audit_logs",
    "cloudflare.avkroken.telemetry",
  ]);
});

test("ruleset contract carries source provenance and inheritance explicitly", () => {
  const value = normalizeRuleset({
    id: 7,
    name: "main",
    source_type: "Organization",
    source: "Avkroken",
    enforcement: "active",
    rules: [],
  }, "2026-09-19T08:00:00.000Z") as any;

  assert.deepEqual(value.provenance, {
    provider: "github",
    source: "repository-rulesets-api",
    scope: "repository",
    sourceId: "7",
    direct: false,
    inherited: true,
    derived: false,
    retrievedAt: "2026-09-19T08:00:00.000Z",
  });
});
