import type { Env } from "./env";

type OverviewTotals = {
  openIssues?: number;
  openPullRequests?: number;
  stalePullRequests?: number;
  actionSamplePassRate?: number | null;
  failedRunsLast7dSample?: number | null;
};

type SecurityCount = { count?: number };
type OverviewSecurity = {
  codeScanning?: SecurityCount;
  dependabot?: SecurityCount;
  secretScanning?: SecurityCount;
};

type OverviewRepo = {
  name?: string;
  attentionScore?: number;
  openIssues?: number;
  openPullRequests?: number | null;
  stalePullRequests?: number | null;
  pushedAt?: string | null;
  actions?: { passRate?: number | null; failedLast7d?: number } | null;
  security?: { codeScanning?: number; dependabot?: number; secretScanning?: number };
};

type Overview = {
  generatedAt?: string;
  repositoryCount?: number;
  totals?: OverviewTotals;
  security?: OverviewSecurity;
  repositories?: OverviewRepo[];
};

export type OrgSnapshot = {
  bucket: string;
  capturedAt: string;
  repositoryCount: number;
  openIssues: number;
  openPullRequests: number;
  stalePullRequests: number;
  actionSamplePassRate: number | null;
  failedRunsLast7dSample: number | null;
  codeScanningAlerts: number;
  dependabotAlerts: number;
  secretScanningAlerts: number;
};

type OrgSnapshotRow = {
  bucket: string;
  captured_at: string;
  repository_count: number;
  open_issues: number;
  open_pull_requests: number;
  stale_pull_requests: number;
  action_sample_pass_rate: number | null;
  failed_runs_last_7d_sample: number | null;
  code_scanning_alerts: number;
  dependabot_alerts: number;
  secret_scanning_alerts: number;
};

function finite(value: unknown, fallback = 0): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function hourlyBucket(value: string): string {
  const date = new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

export function historyConfigured(env: Env): boolean {
  return Boolean(env.STATS_DB);
}

export function snapshotFromOverview(value: Record<string, unknown>): OrgSnapshot {
  const overview = value as Overview;
  const capturedAt = overview.generatedAt && Number.isFinite(Date.parse(overview.generatedAt))
    ? overview.generatedAt
    : new Date().toISOString();
  const totals = overview.totals ?? {};
  const security = overview.security ?? {};
  const hasActionSample = totals.actionSamplePassRate != null || (overview.repositories ?? []).some((repo) => repo.actions != null);
  return {
    bucket: hourlyBucket(capturedAt),
    capturedAt,
    repositoryCount: finite(overview.repositoryCount),
    openIssues: finite(totals.openIssues),
    openPullRequests: finite(totals.openPullRequests),
    stalePullRequests: finite(totals.stalePullRequests),
    actionSamplePassRate: totals.actionSamplePassRate == null ? null : finite(totals.actionSamplePassRate),
    failedRunsLast7dSample: hasActionSample && totals.failedRunsLast7dSample != null
      ? finite(totals.failedRunsLast7dSample)
      : null,
    codeScanningAlerts: finite(security.codeScanning?.count),
    dependabotAlerts: finite(security.dependabot?.count),
    secretScanningAlerts: finite(security.secretScanning?.count),
  };
}

function fromRow(row: OrgSnapshotRow): OrgSnapshot {
  return {
    bucket: row.bucket,
    capturedAt: row.captured_at,
    repositoryCount: row.repository_count,
    openIssues: row.open_issues,
    openPullRequests: row.open_pull_requests,
    stalePullRequests: row.stale_pull_requests,
    actionSamplePassRate: row.action_sample_pass_rate,
    failedRunsLast7dSample: row.failed_runs_last_7d_sample,
    codeScanningAlerts: row.code_scanning_alerts,
    dependabotAlerts: row.dependabot_alerts,
    secretScanningAlerts: row.secret_scanning_alerts,
  };
}

export async function previousOverviewSnapshot(env: Env, currentBucket: string): Promise<OrgSnapshot | null> {
  if (!env.STATS_DB) return null;
  const row = await env.STATS_DB.prepare(
    `SELECT bucket, captured_at, repository_count, open_issues, open_pull_requests,
            stale_pull_requests, action_sample_pass_rate, failed_runs_last_7d_sample,
            code_scanning_alerts, dependabot_alerts, secret_scanning_alerts
       FROM org_snapshots
      WHERE bucket < ?
      ORDER BY bucket DESC
      LIMIT 1`,
  ).bind(currentBucket).first<OrgSnapshotRow>();
  return row ? fromRow(row) : null;
}

function delta(current: number | null, previous: number | null): number | null {
  if (current === null || previous === null) return null;
  return current - previous;
}

export function sinceLast(current: OrgSnapshot, previous: OrgSnapshot | null): Record<string, unknown> {
  if (!previous) return { available: false, reason: "no-previous-snapshot" };
  return {
    available: true,
    previousCapturedAt: previous.capturedAt,
    repositoryCount: delta(current.repositoryCount, previous.repositoryCount),
    openIssues: delta(current.openIssues, previous.openIssues),
    openPullRequests: delta(current.openPullRequests, previous.openPullRequests),
    stalePullRequests: delta(current.stalePullRequests, previous.stalePullRequests),
    actionSamplePassRate: delta(current.actionSamplePassRate, previous.actionSamplePassRate),
    failedRunsLast7dSample: delta(current.failedRunsLast7dSample, previous.failedRunsLast7dSample),
    codeScanningAlerts: delta(current.codeScanningAlerts, previous.codeScanningAlerts),
    dependabotAlerts: delta(current.dependabotAlerts, previous.dependabotAlerts),
    secretScanningAlerts: delta(current.secretScanningAlerts, previous.secretScanningAlerts),
  };
}

export async function captureOverviewSnapshot(env: Env, value: Record<string, unknown>): Promise<void> {
  if (!env.STATS_DB) return;
  const overview = value as Overview;
  const org = snapshotFromOverview(value);
  const statements: D1PreparedStatement[] = [
    env.STATS_DB.prepare(
      `INSERT INTO org_snapshots (
        bucket, captured_at, repository_count, open_issues, open_pull_requests,
        stale_pull_requests, action_sample_pass_rate, failed_runs_last_7d_sample,
        code_scanning_alerts, dependabot_alerts, secret_scanning_alerts
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket) DO UPDATE SET
        captured_at = excluded.captured_at,
        repository_count = excluded.repository_count,
        open_issues = excluded.open_issues,
        open_pull_requests = excluded.open_pull_requests,
        stale_pull_requests = excluded.stale_pull_requests,
        action_sample_pass_rate = excluded.action_sample_pass_rate,
        failed_runs_last_7d_sample = excluded.failed_runs_last_7d_sample,
        code_scanning_alerts = excluded.code_scanning_alerts,
        dependabot_alerts = excluded.dependabot_alerts,
        secret_scanning_alerts = excluded.secret_scanning_alerts`,
    ).bind(
      org.bucket,
      org.capturedAt,
      org.repositoryCount,
      org.openIssues,
      org.openPullRequests,
      org.stalePullRequests,
      org.actionSamplePassRate,
      org.failedRunsLast7dSample,
      org.codeScanningAlerts,
      org.dependabotAlerts,
      org.secretScanningAlerts,
    ),
  ];

  for (const repo of overview.repositories ?? []) {
    if (!repo.name) continue;
    statements.push(env.STATS_DB.prepare(
      `INSERT INTO repo_snapshots (
        bucket, repo, captured_at, attention_score, open_issues, open_pull_requests,
        stale_pull_requests, action_sample_pass_rate, failed_runs_last_7d_sample,
        code_scanning_alerts, dependabot_alerts, secret_scanning_alerts, pushed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(bucket, repo) DO UPDATE SET
        captured_at = excluded.captured_at,
        attention_score = excluded.attention_score,
        open_issues = excluded.open_issues,
        open_pull_requests = excluded.open_pull_requests,
        stale_pull_requests = excluded.stale_pull_requests,
        action_sample_pass_rate = excluded.action_sample_pass_rate,
        failed_runs_last_7d_sample = excluded.failed_runs_last_7d_sample,
        code_scanning_alerts = excluded.code_scanning_alerts,
        dependabot_alerts = excluded.dependabot_alerts,
        secret_scanning_alerts = excluded.secret_scanning_alerts,
        pushed_at = excluded.pushed_at`,
    ).bind(
      org.bucket,
      repo.name,
      org.capturedAt,
      finite(repo.attentionScore),
      finite(repo.openIssues),
      repo.openPullRequests == null ? null : finite(repo.openPullRequests),
      repo.stalePullRequests == null ? null : finite(repo.stalePullRequests),
      repo.actions?.passRate == null ? null : finite(repo.actions.passRate),
      repo.actions == null ? null : finite(repo.actions.failedLast7d),
      finite(repo.security?.codeScanning),
      finite(repo.security?.dependabot),
      finite(repo.security?.secretScanning),
      repo.pushedAt ?? null,
    ));
  }

  await env.STATS_DB.batch(statements);
}

export async function getHistory(env: Env, repo: string | null, days: number): Promise<Record<string, unknown>> {
  if (!env.STATS_DB) return { available: false, reason: "d1-not-bound", points: [] };
  const safeDays = Math.min(365, Math.max(1, Math.floor(days)));
  const since = new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString();
  if (!repo) {
    const result = await env.STATS_DB.prepare(
      `SELECT bucket, captured_at, repository_count, open_issues, open_pull_requests,
              stale_pull_requests, action_sample_pass_rate, failed_runs_last_7d_sample,
              code_scanning_alerts, dependabot_alerts, secret_scanning_alerts
         FROM org_snapshots
        WHERE captured_at >= ?
        ORDER BY captured_at ASC`,
    ).bind(since).all<OrgSnapshotRow>();
    return { available: true, scope: "organization", days: safeDays, points: result.results.map(fromRow) };
  }

  const result = await env.STATS_DB.prepare(
    `SELECT bucket, repo, captured_at, attention_score, open_issues, open_pull_requests,
            stale_pull_requests, action_sample_pass_rate, failed_runs_last_7d_sample,
            code_scanning_alerts, dependabot_alerts, secret_scanning_alerts, pushed_at
       FROM repo_snapshots
      WHERE repo = ? AND captured_at >= ?
      ORDER BY captured_at ASC`,
  ).bind(repo, since).all();
  return { available: true, scope: "repository", repo, days: safeDays, points: result.results };
}