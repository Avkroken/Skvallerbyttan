import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionScore,
  countStalePullRequests,
  severityCounts,
  summarizeWorkflowRuns,
} from "../src/metrics";

test("summarizeWorkflowRuns separates failures, cancellations and pass rate", () => {
  const now = Date.parse("2026-09-01T12:00:00Z");
  const summary = summarizeWorkflowRuns(50, [
    { status: "completed", conclusion: "success", event: "push", updated_at: "2026-09-01T11:00:00Z" },
    { status: "completed", conclusion: "failure", event: "pull_request", updated_at: "2026-09-01T10:00:00Z" },
    { status: "completed", conclusion: "cancelled", event: "push", updated_at: "2026-09-01T09:00:00Z" },
    { status: "in_progress", conclusion: null, event: "workflow_dispatch", updated_at: "2026-09-01T08:00:00Z" },
  ], now);

  assert.equal(summary.totalRuns, 50);
  assert.equal(summary.successfulSample, 1);
  assert.equal(summary.failedSample, 1);
  assert.equal(summary.cancelledSample, 1);
  assert.equal(summary.inProgressSample, 1);
  assert.equal(summary.passRate, 0.5);
  assert.equal(summary.failedLast24h, 1);
  assert.equal(summary.eventCounts.push, 2);
});

test("countStalePullRequests uses the configured age threshold", () => {
  const now = Date.parse("2026-09-01T00:00:00Z");
  const stale = countStalePullRequests([
    { updated_at: "2026-08-01T00:00:00Z" },
    { updated_at: "2026-08-25T00:00:00Z" },
  ], 14, now);
  assert.equal(stale, 1);
});

test("severityCounts normalizes missing and mixed-case severities", () => {
  const counts = severityCounts(
    [{ severity: "HIGH" }, { severity: "high" }, { severity: null }],
    (value) => value.severity,
  );
  assert.deepEqual(counts, { high: 2, unknown: 1 });
});

test("attentionScore prioritizes secrets and critical findings", () => {
  const low = attentionScore({
    criticalAlerts: 0,
    highAlerts: 0,
    secretAlerts: 0,
    dependabotAlerts: 2,
    failedRuns: 1,
    stalePullRequests: 1,
  });
  const high = attentionScore({
    criticalAlerts: 1,
    highAlerts: 0,
    secretAlerts: 1,
    dependabotAlerts: 0,
    failedRuns: 0,
    stalePullRequests: 0,
  });
  assert.ok(high > low);
});
