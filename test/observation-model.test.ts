import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveStatus,
  freshnessFromTimestamp,
  statusFromHttp,
} from "../src/observation-model";

test("status model distinguishes denied, outage and unknown responses", () => {
  assert.equal(statusFromHttp(403).status, "permission_denied");
  assert.equal(statusFromHttp(503).status, "error");
  assert.equal(statusFromHttp(404).status, "unknown");
  assert.equal(statusFromHttp(200).status, "available");
});

test("freshness never turns missing state green", () => {
  assert.equal(freshnessFromTimestamp(null, 60_000), "unknown");
  assert.equal(freshnessFromTimestamp("2026-09-19T08:00:00.000Z", 60_000, Date.parse("2026-09-19T08:00:30.000Z")), "fresh");
  assert.equal(freshnessFromTimestamp("2026-09-19T08:00:00.000Z", 60_000, Date.parse("2026-09-19T08:02:00.000Z")), "stale");
});

test("effective status preserves epistemic boundaries", () => {
  assert.equal(effectiveStatus({
    implemented: true,
    providerSupport: "supported",
    permissionState: "blocked_by_read_only_policy",
    dataState: "unavailable",
    freshness: "unknown",
  }), "permission_denied");

  assert.equal(effectiveStatus({
    implemented: true,
    providerSupport: "not_exposed_by_provider",
    permissionState: "unknown",
    dataState: "unknown",
    freshness: "unknown",
  }), "not_exposed_by_provider");

  assert.equal(effectiveStatus({
    implemented: true,
    providerSupport: "supported",
    permissionState: "granted",
    dataState: "available",
    freshness: "stale",
  }), "stale");
});
