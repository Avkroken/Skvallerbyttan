import assert from "node:assert/strict";
import test from "node:test";
import {
  attentionScore,
  countStalePullRequests,
  severityCounts,
  summarizeActivityTrend,
  summarizePullRequestCycles,
  summarizeWorkflowRuns,
} from "../src/metrics";

test("summarizeWorkflowRuns separates failures, cancellations and pass rate", () => {
  const now = Date.parse("2026-09-01T12:00:00Z");
  const summary = summarizeWorkflowRuns(50, [
    { status: "completed", conclusion: "success", event: "push", run_started_at: "2026-09-01T10:55:00Z", updated_at: "2026-09-01T11:00:00Z" },
    { status: "completed", conclusion: "failure", event: "pull_request", run_started_at: "2026-09-01T09:50:00Z", updated_at: "2026-09-01T10:00:00Z" },
    { status: "completed", conclusion: "cancelled", event: "push", run_started_at: "2026-09-01T08:58:00Z", updated_at: "2026-09-01T09:00:00Z" },
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
  assert.equal(summary.medianDurationMs, 5 * 60 * 1000);
  assert.equal(summary.p95DurationMs, 10 * 60 * 1000);
  assert.equal(summary.mttrMedianMs, 60 * 60 * 1000);
  assert.equal(summary.mttrSampleCount, 1);
});

test("summarizePullRequestCycles calculates lead time and first human review", () => {
  const summary = summarizePullRequestCycles([
    {
      number: 1,
      createdAt: "2026-08-01T00:00:00Z",
      mergedAt: "2026-08-03T00:00:00Z",
      author: "author",
      reviews: [
        { submittedAt: "2026-08-01T01:00:00Z", reviewer: "review-bot[bot]", state: "COMMENTED" },
        { submittedAt: "2026-08-01T06:00:00Z", reviewer: "human", state: "APPROVED" },
      ],
    },
    {
      number: 2,
      createdAt: "2026-08-10T00:00:00Z",
      mergedAt: "2026-08-14T00:00:00Z",
      author: "author",
      reviews: [
        { submittedAt: "2026-08-11T00:00:00Z", reviewer: "other", state: "CHANGES_REQUESTED" },
      ],
    },
  ]);

  assert.equal(summary.sampledPullRequests, 2);
  assert.equal(summary.leadTimeMedianMs, 2 * 24 * 60 * 60 * 1000);
  assert.equal(summary.leadTimeP90Ms, 4 * 24 * 60 * 60 * 1000);
  assert.equal(summary.firstReviewMedianMs, 6 * 60 * 60 * 1000);
  assert.equal(summary.firstReviewP90Ms, 24 * 60 * 60 * 1000);
  assert.equal(summary.reviewedPullRequests, 2);
});

test("summarizeActivityTrend compares latest four weeks with previous four", () => {
  const summary = summarizeActivityTrend([1, 1, 1, 1, 2, 2, 2, 2]);
  assert.equal(summary.previous4w, 4);
  assert.equal(summary.current4w, 8);
  assert.equal(summary.changeRatio, 1);
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
