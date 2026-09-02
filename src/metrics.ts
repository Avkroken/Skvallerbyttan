export type WorkflowRun = {
  conclusion?: string | null;
  created_at?: string;
  event?: string;
  html_url?: string;
  name?: string;
  run_started_at?: string | null;
  status?: string;
  updated_at?: string;
};

export type PullRequestSummary = {
  updated_at?: string;
};

export type ActionSummary = {
  totalRuns: number;
  sampledRuns: number;
  completedSample: number;
  successfulSample: number;
  failedSample: number;
  cancelledSample: number;
  inProgressSample: number;
  passRate: number | null;
  failedLast24h: number;
  failedLast7d: number;
  eventCounts: Record<string, number>;
  latestFailureAt: string | null;
};

const FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "failure",
  "startup_failure",
  "timed_out",
]);

export function summarizeWorkflowRuns(
  totalCount: number,
  runs: WorkflowRun[],
  nowMs = Date.now(),
): ActionSummary {
  let completedSample = 0;
  let successfulSample = 0;
  let failedSample = 0;
  let cancelledSample = 0;
  let inProgressSample = 0;
  let failedLast24h = 0;
  let failedLast7d = 0;
  let latestFailureAt: string | null = null;
  const eventCounts: Record<string, number> = {};

  for (const run of runs) {
    const event = run.event || "unknown";
    eventCounts[event] = (eventCounts[event] ?? 0) + 1;

    if (run.status && run.status !== "completed") {
      inProgressSample += 1;
      continue;
    }

    if (run.status === "completed" || run.conclusion) completedSample += 1;

    if (run.conclusion === "success") {
      successfulSample += 1;
      continue;
    }

    if (run.conclusion === "cancelled") {
      cancelledSample += 1;
      continue;
    }

    if (run.conclusion && FAILURE_CONCLUSIONS.has(run.conclusion)) {
      failedSample += 1;
      const timestamp = Date.parse(run.updated_at || run.created_at || "");
      if (Number.isFinite(timestamp)) {
        if (nowMs - timestamp <= 24 * 60 * 60 * 1000) failedLast24h += 1;
        if (nowMs - timestamp <= 7 * 24 * 60 * 60 * 1000) failedLast7d += 1;
        const iso = new Date(timestamp).toISOString();
        if (!latestFailureAt || iso > latestFailureAt) latestFailureAt = iso;
      }
    }
  }

  const passDenominator = successfulSample + failedSample;

  return {
    totalRuns: Math.max(0, totalCount),
    sampledRuns: runs.length,
    completedSample,
    successfulSample,
    failedSample,
    cancelledSample,
    inProgressSample,
    passRate: passDenominator > 0 ? successfulSample / passDenominator : null,
    failedLast24h,
    failedLast7d,
    eventCounts,
    latestFailureAt,
  };
}

export function countStalePullRequests(
  pulls: PullRequestSummary[],
  staleDays = 14,
  nowMs = Date.now(),
): number {
  const threshold = nowMs - staleDays * 24 * 60 * 60 * 1000;
  return pulls.filter((pull) => {
    const updated = Date.parse(pull.updated_at || "");
    return Number.isFinite(updated) && updated < threshold;
  }).length;
}

export function severityCounts<T>(
  items: T[],
  severityOf: (item: T) => string | null | undefined,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const normalized = (severityOf(item) || "unknown").toLowerCase();
    counts[normalized] = (counts[normalized] ?? 0) + 1;
  }
  return counts;
}

export function attentionScore(input: {
  criticalAlerts: number;
  highAlerts: number;
  secretAlerts: number;
  dependabotAlerts: number;
  failedRuns: number;
  stalePullRequests: number;
}): number {
  return (
    input.secretAlerts * 100 +
    input.criticalAlerts * 50 +
    input.highAlerts * 20 +
    input.dependabotAlerts * 4 +
    input.failedRuns * 5 +
    input.stalePullRequests * 2
  );
}
