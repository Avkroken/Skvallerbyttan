import type { Env } from "./env";
import { organization } from "./env";
import { githubOptionalJson, mapLimit } from "./github";
import {
  summarizeActivityTrend,
  summarizePullRequestCycles,
  summarizeWorkflowRuns,
  type WorkflowRun,
} from "./metrics";

type ClosedPull = {
  number?: number;
  created_at?: string | null;
  merged_at?: string | null;
  user?: { login?: string | null };
};

type PullReview = {
  submitted_at?: string | null;
  state?: string | null;
  user?: { login?: string | null };
};

type Run = WorkflowRun & {
  id?: number;
  display_title?: string;
};

type RunsResponse = {
  total_count?: number;
  workflow_runs?: Run[];
};

type Deployment = {
  id?: number;
  environment?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

type DeploymentStatus = {
  state?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

function parsedTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function capability(key: string, available: boolean, status: number, reason?: string): Record<string, unknown> {
  return { key, available, status, ...(available || !reason ? {} : { reason }) };
}

export async function getRepositoryInsights(env: Env, repoName: string): Promise<Record<string, unknown>> {
  const org = organization(env);
  const encoded = `${encodeURIComponent(org)}/${encodeURIComponent(repoName)}`;
  const [pullsResult, actionsResult, deploymentsResult, participationResult] = await Promise.all([
    githubOptionalJson<ClosedPull[]>(env, `/repos/${encoded}/pulls?state=closed&sort=updated&direction=desc&per_page=50`),
    githubOptionalJson<RunsResponse>(env, `/repos/${encoded}/actions/runs?per_page=100`),
    githubOptionalJson<Deployment[]>(env, `/repos/${encoded}/deployments?per_page=50`),
    githubOptionalJson<{ all?: number[] }>(env, `/repos/${encoded}/stats/participation`),
  ]);

  const mergedPulls = pullsResult.available
    ? pullsResult.value.filter((pull) => pull.number && pull.merged_at).slice(0, 20)
    : [];

  const reviewLookups = await mapLimit(mergedPulls, 4, async (pull) => {
    const result = await githubOptionalJson<PullReview[]>(
      env,
      `/repos/${encoded}/pulls/${encodeURIComponent(String(pull.number))}/reviews?per_page=100`,
    );
    return { pull, result };
  });

  const pullCycles = summarizePullRequestCycles(reviewLookups.map(({ pull, result }) => ({
    number: pull.number ?? 0,
    createdAt: pull.created_at ?? null,
    mergedAt: pull.merged_at ?? null,
    author: pull.user?.login ?? null,
    reviews: result.available ? result.value.map((review) => ({
      submittedAt: review.submitted_at ?? null,
      reviewer: review.user?.login ?? null,
      state: review.state ?? null,
    })) : [],
  })));
  const reviewLookupsAvailable = reviewLookups.filter((entry) => entry.result.available).length;

  const runs = actionsResult.available ? actionsResult.value.workflow_runs ?? [] : [];
  const actionSummary = actionsResult.available
    ? summarizeWorkflowRuns(actionsResult.value.total_count ?? runs.length, runs)
    : null;

  const deployments = deploymentsResult.available ? deploymentsResult.value : [];
  const deploymentSample = deployments.filter((deployment) => deployment.id).slice(0, 20);
  const deploymentStatuses = await mapLimit(deploymentSample, 4, async (deployment) => {
    const result = await githubOptionalJson<DeploymentStatus[]>(
      env,
      `/repos/${encoded}/deployments/${encodeURIComponent(String(deployment.id))}/statuses?per_page=1`,
    );
    return { deployment, result, status: result.available ? result.value[0] ?? null : null };
  });

  const now = Date.now();
  const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
  const deploymentsLast30d = deployments.filter((deployment) => {
    const createdAt = parsedTime(deployment.created_at);
    return createdAt !== null && createdAt >= thirtyDaysAgo;
  }).length;
  const knownStatuses = deploymentStatuses.map((entry) => entry.status).filter((value): value is DeploymentStatus => Boolean(value));
  const successfulDeployments = knownStatuses.filter((status) => status.state === "success");
  const failedDeployments = knownStatuses.filter((status) => status.state === "failure" || status.state === "error");
  const deploymentOutcomeCount = successfulDeployments.length + failedDeployments.length;
  const latestSuccessfulAt = successfulDeployments
    .map((status) => status.created_at || status.updated_at || null)
    .filter((value): value is string => Boolean(value))
    .sort((left, right) => Date.parse(right) - Date.parse(left))[0] ?? null;

  const activity = summarizeActivityTrend(participationResult.available ? participationResult.value.all ?? [] : []);

  return {
    generatedAt: new Date().toISOString(),
    repository: `${org}/${repoName}`,
    pullRequests: {
      available: pullsResult.available,
      closedSample: pullsResult.available ? pullsResult.value.length : 0,
      mergedSample: mergedPulls.length,
      reviewLookups: reviewLookups.length,
      reviewLookupsAvailable,
      reviewTimingSampled: reviewLookups.length > 0 && reviewLookupsAvailable < reviewLookups.length,
      cycle: pullsResult.available ? pullCycles : null,
    },
    actions: {
      available: actionsResult.available,
      summary: actionSummary,
    },
    deployments: {
      available: deploymentsResult.available,
      sample: deployments.length,
      statusSample: deploymentStatuses.length,
      statusAvailable: knownStatuses.length,
      deploymentsLast30d,
      frequencyPerWeek30d: deploymentsLast30d * 7 / 30,
      successfulSample: successfulDeployments.length,
      failedSample: failedDeployments.length,
      changeFailureRateSample: deploymentOutcomeCount > 0 ? failedDeployments.length / deploymentOutcomeCount : null,
      latestSuccessfulAt,
    },
    activity: {
      available: participationResult.available,
      ...activity,
    },
    capabilities: [
      capability("closed-pull-requests", pullsResult.available, pullsResult.status, pullsResult.available ? undefined : pullsResult.reason),
      capability(
        "pull-request-reviews",
        reviewLookups.length === 0 || reviewLookupsAvailable === reviewLookups.length,
        reviewLookups.find((entry) => !entry.result.available)?.result.status ?? 200,
        reviewLookups.find((entry) => !entry.result.available)?.result.reason,
      ),
      capability("actions-insights", actionsResult.available, actionsResult.status, actionsResult.available ? undefined : actionsResult.reason),
      capability("deployment-insights", deploymentsResult.available, deploymentsResult.status, deploymentsResult.available ? undefined : deploymentsResult.reason),
      capability("participation-trend", participationResult.available, participationResult.status, participationResult.available ? undefined : participationResult.reason),
    ],
  };
}
