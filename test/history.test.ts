import assert from "node:assert/strict";
import test from "node:test";
import { sinceLast, snapshotFromOverview } from "../src/history";

test("snapshotFromOverview reduces dashboard data to non-secret hourly history", () => {
  const snapshot = snapshotFromOverview({
    generatedAt: "2026-09-02T07:42:13.000Z",
    repositoryCount: 4,
    totals: {
      openIssues: 8,
      openPullRequests: 3,
      stalePullRequests: 1,
      actionSamplePassRate: 0.9,
      failedRunsLast7dSample: 2,
    },
    security: {
      codeScanning: { count: 5 },
      dependabot: { count: 6 },
      secretScanning: { count: 1 },
    },
  });

  assert.equal(snapshot.bucket, "2026-09-02T07:00:00.000Z");
  assert.equal(snapshot.repositoryCount, 4);
  assert.equal(snapshot.actionSamplePassRate, 0.9);
  assert.equal(snapshot.failedRunsLast7dSample, 2);
  assert.equal(snapshot.secretScanningAlerts, 1);
});

test("snapshotFromOverview keeps missing Actions data as null", () => {
  const snapshot = snapshotFromOverview({
    generatedAt: "2026-09-02T08:00:00.000Z",
    repositoryCount: 1,
    totals: {
      actionSamplePassRate: null,
      failedRunsLast7dSample: 0,
    },
    repositories: [{ name: "private-repo", actions: null }],
  });

  assert.equal(snapshot.actionSamplePassRate, null);
  assert.equal(snapshot.failedRunsLast7dSample, null);
});

test("sinceLast returns explicit sample-labelled deltas from the previous snapshot", () => {
  const current = snapshotFromOverview({
    generatedAt: "2026-09-02T08:05:00.000Z",
    repositoryCount: 4,
    totals: { openIssues: 7, openPullRequests: 4, stalePullRequests: 1, actionSamplePassRate: 0.95, failedRunsLast7dSample: 1 },
    security: { codeScanning: { count: 3 }, dependabot: { count: 4 }, secretScanning: { count: 0 } },
  });
  const previous = snapshotFromOverview({
    generatedAt: "2026-09-02T07:05:00.000Z",
    repositoryCount: 4,
    totals: { openIssues: 8, openPullRequests: 3, stalePullRequests: 2, actionSamplePassRate: 0.9, failedRunsLast7dSample: 2 },
    security: { codeScanning: { count: 4 }, dependabot: { count: 4 }, secretScanning: { count: 1 } },
  });

  const delta = sinceLast(current, previous) as Record<string, unknown>;
  assert.equal(delta.available, true);
  assert.equal(delta.openIssues, -1);
  assert.equal(delta.openPullRequests, 1);
  assert.equal(delta.stalePullRequests, -1);
  assert.ok(Math.abs(Number(delta.actionSamplePassRate) - 0.05) < 1e-12);
  assert.equal(delta.failedRunsLast7dSample, -1);
  assert.equal(delta.codeScanningAlerts, -1);
  assert.equal(delta.secretScanningAlerts, -1);
});
