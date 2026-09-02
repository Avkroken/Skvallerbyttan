import type { Env } from "./env";
import { organization } from "./env";
import {
  githubJson,
  githubListAll,
  githubOptionalJson,
  githubResponse,
  mapLimit,
  type OptionalResult,
} from "./github";
import {
  attentionScore,
  countStalePullRequests,
  severityCounts,
  summarizeWorkflowRuns,
  type ActionSummary,
  type WorkflowRun,
} from "./metrics";

type Repo = {
  archived?: boolean;
  default_branch?: string;
  disabled?: boolean;
  fork?: boolean;
  forks_count?: number;
  full_name: string;
  html_url: string;
  language?: string | null;
  name: string;
  open_issues_count?: number;
  private?: boolean;
  pushed_at?: string | null;
  security_and_analysis?: Record<string, unknown>;
  size?: number;
  stargazers_count?: number;
  subscribers_count?: number;
  updated_at?: string;
  visibility?: string;
  watchers_count?: number;
};

type Pull = {
  draft?: boolean;
  html_url?: string;
  number?: number;
  title?: string;
  updated_at?: string;
  user?: { login?: string };
};

type Run = WorkflowRun & {
  actor?: { login?: string };
  display_title?: string;
  id?: number;
};

type RunsResponse = { total_count?: number; workflow_runs?: Run[] };
type CodeAlert = { repository?: { name?: string }; rule?: { security_severity_level?: string | null; severity?: string | null } };
type DependabotAlert = { repository?: { name?: string }; security_advisory?: { severity?: string | null } };
type SecretAlert = { repository?: { name?: string }; secret_type?: string; secret_type_display_name?: string };

type RepoSecurity = {
  codeScanning: number;
  codeScanningSeverity: Record<string, number>;
  dependabot: number;
  dependabotSeverity: Record<string, number>;
  secretScanning: number;
};

type SecurityOverview = {
  codeScanning: { available: boolean; count: number; severities: Record<string, number>; truncated: boolean };
  dependabot: { available: boolean; count: number; severities: Record<string, number>; truncated: boolean };
  secretScanning: { available: boolean; count: number; truncated: boolean };
  byRepo: Record<string, RepoSecurity>;
  capabilities: Array<{ key: string; available: boolean; status: number; reason?: string }>;
};

const emptySecurity = (): RepoSecurity => ({
  codeScanning: 0,
  codeScanningSeverity: {},
  dependabot: 0,
  dependabotSeverity: {},
  secretScanning: 0,
});

function bump(target: Record<string, number>, severity: string | null | undefined): void {
  const key = (severity || "unknown").toLowerCase();
  target[key] = (target[key] ?? 0) + 1;
}

function capability<T>(key: string, result: OptionalResult<T>): Record<string, unknown> {
  return {
    key,
    available: result.available,
    status: result.status,
    ...(result.available ? {} : { reason: result.reason }),
  };
}

async function getSecurityOverview(env: Env): Promise<SecurityOverview> {
  const org = organization(env);
  const [code, dependabot, secret] = await Promise.all([
    githubListAll<CodeAlert>(env, `/orgs/${encodeURIComponent(org)}/code-scanning/alerts?state=open&per_page=100`, 20),
    githubListAll<DependabotAlert>(env, `/orgs/${encodeURIComponent(org)}/dependabot/alerts?state=open&per_page=100`, 20),
    githubListAll<SecretAlert>(env, `/orgs/${encodeURIComponent(org)}/secret-scanning/alerts?state=open&per_page=100`, 20),
  ]);

  const byRepo: Record<string, RepoSecurity> = {};
  const getRepo = (name?: string): RepoSecurity | null => {
    const key = name?.trim().toLowerCase();
    if (!key) return null;
    byRepo[key] ??= emptySecurity();
    return byRepo[key];
  };

  if (code.available) for (const alert of code.value) {
    const repo = getRepo(alert.repository?.name);
    if (!repo) continue;
    repo.codeScanning += 1;
    bump(repo.codeScanningSeverity, alert.rule?.security_severity_level || alert.rule?.severity);
  }
  if (dependabot.available) for (const alert of dependabot.value) {
    const repo = getRepo(alert.repository?.name);
    if (!repo) continue;
    repo.dependabot += 1;
    bump(repo.dependabotSeverity, alert.security_advisory?.severity);
  }
  if (secret.available) for (const alert of secret.value) {
    const repo = getRepo(alert.repository?.name);
    if (repo) repo.secretScanning += 1;
  }

  return {
    codeScanning: {
      available: code.available,
      count: code.available ? code.value.length : 0,
      severities: code.available ? severityCounts(code.value, (item) => item.rule?.security_severity_level || item.rule?.severity) : {},
      truncated: code.truncated,
    },
    dependabot: {
      available: dependabot.available,
      count: dependabot.available ? dependabot.value.length : 0,
      severities: dependabot.available ? severityCounts(dependabot.value, (item) => item.security_advisory?.severity) : {},
      truncated: dependabot.truncated,
    },
    secretScanning: {
      available: secret.available,
      count: secret.available ? secret.value.length : 0,
      truncated: secret.truncated,
    },
    byRepo,
    capabilities: [
      { key: "code-scanning", available: code.available, status: code.status, ...(code.available ? {} : { reason: code.reason }) },
      { key: "dependabot", available: dependabot.available, status: dependabot.status, ...(dependabot.available ? {} : { reason: dependabot.reason }) },
      { key: "secret-scanning", available: secret.available, status: secret.status, ...(secret.available ? {} : { reason: secret.reason }) },
    ],
  };
}

function lastPage(link: string | null): number | null {
  const part = link?.split(",").find((value) => value.includes('rel="last"'));
  const match = part?.match(/[?&]page=(\d+)/);
  return match ? Number(match[1]) : null;
}

function newestPulls(pulls: Pull[]): Pull[] {
  return [...pulls].sort(
    (left, right) => Date.parse(right.updated_at ?? "") - Date.parse(left.updated_at ?? ""),
  );
}

async function getPulls(env: Env, fullName: string): Promise<{
  available: boolean;
  count: number;
  pulls: Pull[];
  stale: number;
  staleSampled: boolean;
  status: number;
  reason?: string;
}> {
  const path = `/repos/${fullName}/pulls?state=open&sort=updated&direction=asc&per_page=100`;
  const response = await githubResponse(env, path);
  if (!response.ok) return {
    available: false,
    count: 0,
    pulls: [],
    stale: 0,
    staleSampled: false,
    status: response.status,
    reason: (await response.text()).slice(0, 220),
  };

  const oldestPulls = await response.json<Pull[]>();
  const page = lastPage(response.headers.get("link"));
  let count = oldestPulls.length;
  let pulls = newestPulls(oldestPulls);
  const staleSampled = Boolean(page && page > 1);
  if (page && page > 1) {
    const tail = await githubOptionalJson<Pull[]>(env, `${path}&page=${page}`);
    if (!tail.available) {
      return {
        available: false,
        count: 0,
        pulls: [],
        stale: 0,
        staleSampled: false,
        status: tail.status,
        reason: tail.reason,
      };
    }
    count = (page - 1) * 100 + tail.value.length;
    pulls = newestPulls(tail.value);
  }
  return {
    available: true,
    count,
    pulls,
    stale: countStalePullRequests(oldestPulls),
    staleSampled,
    status: response.status,
  };
}

async function getActions(env: Env, fullName: string): Promise<{
  available: boolean;
  summary: ActionSummary | null;
  runs: Run[];
  status: number;
  reason?: string;
}> {
  const result = await githubOptionalJson<RunsResponse>(env, `/repos/${fullName}/actions/runs?per_page=100`);
  if (!result.available) return { available: false, summary: null, runs: [], status: result.status, reason: result.reason };
  const runs = result.value.workflow_runs ?? [];
  return {
    available: true,
    summary: summarizeWorkflowRuns(result.value.total_count ?? runs.length, runs),
    runs,
    status: result.status,
  };
}

export async function getOverview(env: Env): Promise<Record<string, unknown>> {
  const org = organization(env);
  const reposResult = await githubListAll<Repo>(env, `/orgs/${encodeURIComponent(org)}/repos?type=all&sort=full_name&per_page=100`, 10);
  if (!reposResult.available) throw new Error(`Could not list repositories: ${reposResult.status} ${reposResult.reason}`);

  const repos = reposResult.value.filter((repo) => !repo.disabled);
  const security = await getSecurityOverview(env);
  const operational = await mapLimit(repos, 4, async (repo) => {
    const [pulls, actions] = await Promise.all([getPulls(env, repo.full_name), getActions(env, repo.full_name)]);
    const repoSecurity = security.byRepo[repo.name.toLowerCase()] ?? emptySecurity();
    const openIssues = Math.max(0, (repo.open_issues_count ?? 0) - (pulls.available ? pulls.count : 0));
    const criticalAlerts = (repoSecurity.codeScanningSeverity.critical ?? 0) + (repoSecurity.dependabotSeverity.critical ?? 0);
    const highAlerts = (repoSecurity.codeScanningSeverity.high ?? 0) + (repoSecurity.dependabotSeverity.high ?? 0);

    return {
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      visibility: repo.visibility ?? (repo.private ? "private" : "public"),
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
      defaultBranch: repo.default_branch ?? null,
      language: repo.language ?? null,
      stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      sizeKb: repo.size ?? 0,
      pushedAt: repo.pushed_at ?? null,
      updatedAt: repo.updated_at ?? null,
      openIssues,
      openPullRequests: pulls.available ? pulls.count : null,
      stalePullRequests: pulls.available ? pulls.stale : null,
      stalePullRequestsSampled: pulls.available ? pulls.staleSampled : false,
      actions: actions.summary,
      security: repoSecurity,
      attentionScore: attentionScore({
        criticalAlerts,
        highAlerts,
        secretAlerts: repoSecurity.secretScanning,
        dependabotAlerts: repoSecurity.dependabot,
        failedRuns: actions.summary?.failedLast7d ?? 0,
        stalePullRequests: pulls.stale,
      }),
      capabilities: { pullRequests: pulls.available, actions: actions.available },
    };
  });

  operational.sort((a, b) => b.attentionScore - a.attentionScore || a.name.localeCompare(b.name));
  const actionRows = operational.filter((repo) => repo.actions !== null);
  const successes = actionRows.reduce((sum, repo) => sum + (repo.actions?.successfulSample ?? 0), 0);
  const failures = actionRows.reduce((sum, repo) => sum + (repo.actions?.failedSample ?? 0), 0);
  const rateLimit = await githubOptionalJson<{ resources?: { core?: { limit?: number; remaining?: number; reset?: number } } }>(env, "/rate_limit");

  return {
    generatedAt: new Date().toISOString(),
    organization: org,
    repositoryCount: repos.length,
    repositoriesTruncated: reposResult.truncated,
    totals: {
      stars: repos.reduce((sum, repo) => sum + (repo.stargazers_count ?? 0), 0),
      forks: repos.reduce((sum, repo) => sum + (repo.forks_count ?? 0), 0),
      openIssues: operational.reduce((sum, repo) => sum + repo.openIssues, 0),
      openPullRequests: operational.reduce((sum, repo) => sum + (repo.openPullRequests ?? 0), 0),
      stalePullRequests: operational.reduce((sum, repo) => sum + (repo.stalePullRequests ?? 0), 0),
      stalePullRequestsSampled: operational.some((repo) => repo.stalePullRequestsSampled),
      actionRuns: actionRows.reduce((sum, repo) => sum + (repo.actions?.totalRuns ?? 0), 0),
      actionSamplePassRate: successes + failures > 0 ? successes / (successes + failures) : null,
      failedRunsLast7dSample: actionRows.reduce((sum, repo) => sum + (repo.actions?.failedLast7d ?? 0), 0),
    },
    security: {
      codeScanning: security.codeScanning,
      dependabot: security.dependabot,
      secretScanning: security.secretScanning,
    },
    capabilities: [
      ...security.capabilities,
      { key: "actions", available: operational.some((repo) => repo.capabilities.actions), status: operational.some((repo) => repo.capabilities.actions) ? 200 : 403 },
      { key: "pull-requests", available: operational.some((repo) => repo.capabilities.pullRequests), status: operational.some((repo) => repo.capabilities.pullRequests) ? 200 : 403 },
    ],
    rateLimit: rateLimit.available ? {
      limit: rateLimit.value.resources?.core?.limit ?? null,
      remaining: rateLimit.value.resources?.core?.remaining ?? null,
      reset: rateLimit.value.resources?.core?.reset ?? null,
    } : null,
    repositories: operational,
  };
}

function secretTypes(alerts: SecretAlert[]): Record<string, number> {
  const result: Record<string, number> = {};
  for (const alert of alerts) {
    const key = alert.secret_type_display_name || alert.secret_type || "unknown";
    result[key] = (result[key] ?? 0) + 1;
  }
  return result;
}

export async function getRepositoryDetail(env: Env, repoName: string): Promise<Record<string, unknown>> {
  const org = organization(env);
  const encoded = `${encodeURIComponent(org)}/${encodeURIComponent(repoName)}`;
  const raw = `${org}/${repoName}`;
  const repo = await githubJson<Repo>(env, `/repos/${encoded}`);

  const [pulls, actions, languages, views, clones, referrers, paths, participation, contributors, releases, workflows, rulesets, branches, deployments, code, dependabot, secret] = await Promise.all([
    getPulls(env, raw),
    getActions(env, raw),
    githubOptionalJson<Record<string, number>>(env, `/repos/${encoded}/languages`),
    githubOptionalJson<{ count?: number; uniques?: number; views?: Array<{ timestamp?: string; count?: number; uniques?: number }> }>(env, `/repos/${encoded}/traffic/views?per=day`),
    githubOptionalJson<{ count?: number; uniques?: number; clones?: Array<{ timestamp?: string; count?: number; uniques?: number }> }>(env, `/repos/${encoded}/traffic/clones?per=day`),
    githubOptionalJson<Array<{ referrer?: string; count?: number; uniques?: number }>>(env, `/repos/${encoded}/traffic/popular/referrers`),
    githubOptionalJson<Array<{ path?: string; title?: string; count?: number; uniques?: number }>>(env, `/repos/${encoded}/traffic/popular/paths`),
    githubOptionalJson<{ all?: number[]; owner?: number[] }>(env, `/repos/${encoded}/stats/participation`),
    githubOptionalJson<Array<{ login?: string; contributions?: number; html_url?: string }>>(env, `/repos/${encoded}/contributors?per_page=100`),
    githubOptionalJson<Array<{ tag_name?: string; name?: string; published_at?: string; draft?: boolean; prerelease?: boolean; html_url?: string }>>(env, `/repos/${encoded}/releases?per_page=20`),
    githubOptionalJson<{ total_count?: number; workflows?: Array<{ id?: number; name?: string; path?: string; state?: string; html_url?: string }> }>(env, `/repos/${encoded}/actions/workflows?per_page=100`),
    githubOptionalJson<Array<{ id?: number; name?: string; target?: string; source_type?: string; enforcement?: string }>>(env, `/repos/${encoded}/rulesets?includes_parents=true`),
    githubOptionalJson<Array<{ name?: string; protected?: boolean }>>(env, `/repos/${encoded}/branches?per_page=100`),
    githubOptionalJson<Array<{ id?: number; environment?: string; created_at?: string; updated_at?: string }>>(env, `/repos/${encoded}/deployments?per_page=100`),
    githubListAll<CodeAlert>(env, `/repos/${encoded}/code-scanning/alerts?state=open&per_page=100`, 10),
    githubListAll<DependabotAlert>(env, `/repos/${encoded}/dependabot/alerts?state=open&per_page=100`, 10),
    githubListAll<SecretAlert>(env, `/repos/${encoded}/secret-scanning/alerts?state=open&per_page=100`, 10),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    organization: org,
    repository: {
      name: repo.name,
      fullName: repo.full_name,
      url: repo.html_url,
      visibility: repo.visibility ?? (repo.private ? "private" : "public"),
      archived: Boolean(repo.archived),
      fork: Boolean(repo.fork),
      defaultBranch: repo.default_branch ?? null,
      language: repo.language ?? null,
      stars: repo.stargazers_count ?? 0,
      watchers: repo.watchers_count ?? 0,
      subscribers: repo.subscribers_count ?? 0,
      forks: repo.forks_count ?? 0,
      sizeKb: repo.size ?? 0,
      openIssues: Math.max(0, (repo.open_issues_count ?? 0) - (pulls.available ? pulls.count : 0)),
      openPullRequests: pulls.available ? pulls.count : null,
      pushedAt: repo.pushed_at ?? null,
      updatedAt: repo.updated_at ?? null,
      securityAndAnalysis: repo.security_and_analysis ?? null,
    },
    actions: {
      available: actions.available,
      summary: actions.summary,
      recentRuns: actions.runs.slice(0, 25).map((run) => ({
        id: run.id ?? null,
        name: run.name ?? null,
        title: run.display_title ?? null,
        event: run.event ?? null,
        status: run.status ?? null,
        conclusion: run.conclusion ?? null,
        actor: run.actor?.login ?? null,
        createdAt: run.created_at ?? null,
        updatedAt: run.updated_at ?? null,
        url: run.html_url ?? null,
      })),
      workflows: workflows.available ? workflows.value.workflows ?? [] : [],
      workflowCount: workflows.available ? workflows.value.total_count ?? workflows.value.workflows?.length ?? 0 : null,
    },
    pullRequests: {
      available: pulls.available,
      count: pulls.available ? pulls.count : null,
      stale: pulls.available ? pulls.stale : null,
      staleSampled: pulls.available ? pulls.staleSampled : false,
      open: pulls.pulls.slice(0, 50).map((pull) => ({
        number: pull.number ?? null,
        title: pull.title ?? null,
        draft: Boolean(pull.draft),
        author: pull.user?.login ?? null,
        updatedAt: pull.updated_at ?? null,
        url: pull.html_url ?? null,
      })),
    },
    security: {
      codeScanning: code.available ? { count: code.value.length, severities: severityCounts(code.value, (item) => item.rule?.security_severity_level || item.rule?.severity), truncated: code.truncated } : null,
      dependabot: dependabot.available ? { count: dependabot.value.length, severities: severityCounts(dependabot.value, (item) => item.security_advisory?.severity), truncated: dependabot.truncated } : null,
      secretScanning: secret.available ? { count: secret.value.length, types: secretTypes(secret.value), truncated: secret.truncated } : null,
    },
    traffic: {
      views: views.available ? views.value : null,
      clones: clones.available ? clones.value : null,
      referrers: referrers.available ? referrers.value : [],
      paths: paths.available ? paths.value : [],
    },
    activity: {
      participation: participation.available ? participation.value : null,
      contributors: contributors.available ? contributors.value.slice(0, 25).map((item) => ({ login: item.login ?? null, contributions: item.contributions ?? 0, url: item.html_url ?? null })) : [],
      releases: releases.available ? releases.value : [],
      deployments: deployments.available ? deployments.value : [],
    },
    code: {
      languages: languages.available ? languages.value : null,
      branches: branches.available ? branches.value : [],
      rulesets: rulesets.available ? rulesets.value : [],
    },
    capabilities: [
      { key: "pull-requests", available: pulls.available, status: pulls.status, ...(pulls.available ? {} : { reason: pulls.reason }) },
      { key: "actions", available: actions.available, status: actions.status, ...(actions.available ? {} : { reason: actions.reason }) },
      capability("languages", languages),
      capability("traffic-views", views),
      capability("traffic-clones", clones),
      capability("traffic-referrers", referrers),
      capability("traffic-paths", paths),
      capability("participation", participation),
      capability("contributors", contributors),
      capability("releases", releases),
      capability("workflows", workflows),
      capability("rulesets", rulesets),
      capability("branches", branches),
      capability("deployments", deployments),
      { key: "code-scanning", available: code.available, status: code.status, ...(code.available ? {} : { reason: code.reason }) },
      { key: "dependabot", available: dependabot.available, status: dependabot.status, ...(dependabot.available ? {} : { reason: dependabot.reason }) },
      { key: "secret-scanning", available: secret.available, status: secret.status, ...(secret.available ? {} : { reason: secret.reason }) },
    ],
  };
}
