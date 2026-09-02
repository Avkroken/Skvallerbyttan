export type WorkflowRun = {
  conclusion?: string | null;
  created_at?: string;
  event?: string;
  html_url?: string;
  name?: string;
  workflow_id?: number;
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
  medianDurationMs: number | null;
  p95DurationMs: number | null;
  mttrMedianMs: number | null;
  mttrSampleCount: number;
};

export type PullCycleInput = {
  number: number;
  createdAt: string | null;
  mergedAt: string | null;
  author: string | null;
  reviews: Array<{
    submittedAt: string | null;
    reviewer: string | null;
    state: string | null;
  }>;
};

export type PullCycleSummary = {
  sampledPullRequests: number;
  leadTimeMedianMs: number | null;
  leadTimeP90Ms: number | null;
  firstReviewMedianMs: number | null;
  firstReviewP90Ms: number | null;
  reviewedPullRequests: number;
};

const FAILURE_CONCLUSIONS = new Set([
  "action_required",
  "failure",
  "startup_failure",
  "timed_out",
]);

function quantile(values: number[], percentile: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(percentile * sorted.length) - 1));
  return sorted[index];
}

function timestamp(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function workflowIdentity(run: WorkflowRun): string {
  if (Number.isSafeInteger(run.workflow_id) && Number(run.workflow_id) > 0) return `id:${run.workflow_id}`;
  return `name:${run.name || "unknown"}`;
}

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
  const durations: number[] = [];
  const completed: Array<{ conclusion: string; endedAt: number; workflow: string }> = [];

  for (const run of runs) {
    const event = run.event || "unknown";
    eventCounts[event] = (eventCounts[event] ?? 0) + 1;

    if (run.status && run.status !== "completed") {
      inProgressSample += 1;
      continue;
    }

    if (run.status === "completed" || run.conclusion) completedSample += 1;

    const startedAt = timestamp(run.run_started_at || run.created_at);
    const endedAt = timestamp(run.updated_at);
    if (startedAt !== null && endedAt !== null && endedAt >= startedAt) {
      durations.push(endedAt - startedAt);
    }
    if (run.conclusion && endedAt !== null) {
      completed.push({ conclusion: run.conclusion, endedAt, workflow: workflowIdentity(run) });
    }

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
      const failedAt = timestamp(run.updated_at || run.created_at);
      if (failedAt !== null) {
        if (nowMs - failedAt <= 24 * 60 * 60 * 1000) failedLast24h += 1;
        if (nowMs - failedAt <= 7 * 24 * 60 * 60 * 1000) failedLast7d += 1;
        const iso = new Date(failedAt).toISOString();
        if (!latestFailureAt || iso > latestFailureAt) latestFailureAt = iso;
      }
    }
  }

  const recoveryDurations: number[] = [];
  const incidentStartedAt = new Map<string, number>();
  for (const run of completed.sort((left, right) => left.endedAt - right.endedAt)) {
    if (FAILURE_CONCLUSIONS.has(run.conclusion)) {
      if (!incidentStartedAt.has(run.workflow)) incidentStartedAt.set(run.workflow, run.endedAt);
      continue;
    }
    const startedAt = incidentStartedAt.get(run.workflow);
    if (run.conclusion === "success" && startedAt !== undefined) {
      recoveryDurations.push(Math.max(0, run.endedAt - startedAt));
      incidentStartedAt.delete(run.workflow);
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
    medianDurationMs: quantile(durations, 0.5),
    p95DurationMs: quantile(durations, 0.95),
    mttrMedianMs: quantile(recoveryDurations, 0.5),
    mttrSampleCount: recoveryDurations.length,
  };
}

export function summarizePullRequestCycles(pulls: PullCycleInput[]): PullCycleSummary {
  const leadTimes: number[] = [];
  const firstReviewTimes: number[] = [];

  for (const pull of pulls) {
    const createdAt = timestamp(pull.createdAt);
    const mergedAt = timestamp(pull.mergedAt);
    if (createdAt === null || mergedAt === null || mergedAt < createdAt) continue;
    leadTimes.push(mergedAt - createdAt);

    const author = pull.author?.toLowerCase() ?? null;
    const firstReviewAt = pull.reviews
      .filter((review) => {
        const state = review.state?.toUpperCase();
        const reviewer = review.reviewer?.toLowerCase() ?? null;
        return Boolean(
          review.submittedAt &&
          reviewer &&
          reviewer !== author &&
          !reviewer.endsWith("[bot]") &&
          (state === "APPROVED" || state === "CHANGES_REQUESTED" || state === "COMMENTED"),
        );
      })
      .map((review) => timestamp(review.submittedAt))
      .filter((value): value is number => value !== null && value >= createdAt)
      .sort((left, right) => left - right)[0];

    if (firstReviewAt !== undefined) firstReviewTimes.push(firstReviewAt - createdAt);
  }

  return {
    sampledPullRequests: leadTimes.length,
    leadTimeMedianMs: quantile(leadTimes, 0.5),
    leadTimeP90Ms: quantile(leadTimes, 0.9),
    firstReviewMedianMs: quantile(firstReviewTimes, 0.5),
    firstReviewP90Ms: quantile(firstReviewTimes, 0.9),
    reviewedPullRequests: firstReviewTimes.length,
  };
}

export function summarizeActivityTrend(weeklyCommits: number[]): {
  current4w: number;
  previous4w: number;
  changeRatio: number | null;
} {
  const values = weeklyCommits.map((value) => Math.max(0, Number(value) || 0));
  const current4w = values.slice(-4).reduce((sum, value) => sum + value, 0);
  const previous4w = values.slice(-8, -4).reduce((sum, value) => sum + value, 0);
  return {
    current4w,
    previous4w,
    changeRatio: previous4w > 0 ? (current4w - previous4w) / previous4w : current4w > 0 ? 1 : null,
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
