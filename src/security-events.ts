import type { Env } from "./env";

const SECURITY_WEBHOOK_EVENTS = new Set([
  "code_scanning_alert",
  "dependabot_alert",
  "secret_scanning_alert",
]);

type PackageRef = {
  ecosystem?: string | null;
  name?: string | null;
};

type SecurityAlertPayload = {
  action?: string | null;
  alert?: {
    number?: number | null;
    rule?: {
      id?: string | null;
      name?: string | null;
      security_severity_level?: string | null;
      severity?: string | null;
    } | null;
    dependency?: { package?: PackageRef | null } | null;
    security_advisory?: {
      ghsa_id?: string | null;
      severity?: string | null;
    } | null;
    security_vulnerability?: {
      package?: PackageRef | null;
      severity?: string | null;
    } | null;
    dismissed_reason?: string | null;
    resolution?: string | null;
    secret_type?: string | null;
    secret_type_display_name?: string | null;
  } | null;
};

export type SecurityEventRecord = {
  deliveryId: string;
  event: string;
  repo: string;
  alertNumber: number | null;
  action: string;
  severity: string | null;
  subject: string | null;
  resolution: string | null;
  receivedAt: string;
};

type SecurityCountRow = {
  repo: string;
  event: string;
  action: string;
  count: number;
};

type RecentSecurityRow = {
  repo: string;
  event: string;
  alert_number: number | null;
  action: string;
  severity: string | null;
  subject: string | null;
  resolution: string | null;
  received_at: string;
};

type FirstRecordedRow = { first_recorded_at: string | null };

type TypeSummary = {
  discovered: number;
  remediated: number;
  dismissed: number;
  reopened: number;
};

type SecurityActivityTotals = {
  totalEvents: number;
  discovered: number;
  remediated: number;
  dismissed: number;
  reopened: number;
  codeScanning: TypeSummary;
  dependabot: TypeSummary & { reintroduced: number; patchRateClosed: number | null };
  secretScanning: TypeSummary;
};

function clean(value: string | null | undefined): string | null {
  const result = value?.trim();
  return result ? result : null;
}

function normalized(value: string | null | undefined): string | null {
  return clean(value)?.toLowerCase() ?? null;
}

function packageSubject(value: PackageRef | null | undefined): string | null {
  const name = clean(value?.name);
  if (!name) return null;
  const ecosystem = clean(value?.ecosystem);
  return ecosystem ? `${ecosystem}:${name}` : name;
}

export function securityEventFromWebhook(
  deliveryId: string,
  event: string,
  repo: string | null,
  payload: unknown,
  receivedAt = new Date().toISOString(),
): SecurityEventRecord | null {
  if (!SECURITY_WEBHOOK_EVENTS.has(event) || !repo) return null;
  if (!payload || typeof payload !== "object") return null;
  const parsed = payload as SecurityAlertPayload;
  const action = normalized(parsed.action);
  if (!action) return null;
  const alert = parsed.alert;
  if (!alert) return null;

  let severity: string | null = null;
  let subject: string | null = null;
  let resolution: string | null = null;

  if (event === "code_scanning_alert") {
    severity = normalized(alert.rule?.security_severity_level || alert.rule?.severity);
    subject = clean(alert.rule?.id || alert.rule?.name);
    resolution = normalized(alert.dismissed_reason);
  } else if (event === "dependabot_alert") {
    severity = normalized(alert.security_advisory?.severity || alert.security_vulnerability?.severity);
    subject = packageSubject(alert.dependency?.package)
      || packageSubject(alert.security_vulnerability?.package)
      || clean(alert.security_advisory?.ghsa_id);
    resolution = normalized(alert.dismissed_reason);
  } else if (event === "secret_scanning_alert") {
    subject = clean(alert.secret_type_display_name || alert.secret_type);
    resolution = normalized(alert.resolution);
  }

  const alertNumber = alert.number == null || !Number.isFinite(Number(alert.number))
    ? null
    : Number(alert.number);

  return {
    deliveryId,
    event,
    repo,
    alertNumber,
    action,
    severity,
    subject,
    resolution,
    receivedAt,
  };
}

export async function recordSecurityEvent(env: Env, record: SecurityEventRecord): Promise<void> {
  if (!env.STATS_DB) return;
  await env.STATS_DB.prepare(
    `INSERT OR IGNORE INTO security_events (
       delivery_id, event, repo, alert_number, action, severity, subject, resolution, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    record.deliveryId,
    record.event,
    record.repo,
    record.alertNumber,
    record.action,
    record.severity,
    record.subject,
    record.resolution,
    record.receivedAt,
  ).run();
}

function emptyTypeSummary(): TypeSummary {
  return { discovered: 0, remediated: 0, dismissed: 0, reopened: 0 };
}

export function summarizeSecurityRows(rows: SecurityCountRow[]): SecurityActivityTotals {
  const codeScanning = emptyTypeSummary();
  const dependabot = { ...emptyTypeSummary(), reintroduced: 0, patchRateClosed: null as number | null };
  const secretScanning = emptyTypeSummary();
  let totalEvents = 0;

  for (const row of rows) {
    const count = Math.max(0, Number(row.count) || 0);
    totalEvents += count;
    if (row.event === "code_scanning_alert") {
      if (row.action === "created") codeScanning.discovered += count;
      if (row.action === "fixed") codeScanning.remediated += count;
      if (row.action === "closed_by_user") codeScanning.dismissed += count;
      if (row.action === "reopened") codeScanning.reopened += count;
    } else if (row.event === "dependabot_alert") {
      if (row.action === "created") dependabot.discovered += count;
      if (row.action === "fixed") dependabot.remediated += count;
      if (row.action === "dismissed" || row.action === "auto_dismissed") dependabot.dismissed += count;
      if (row.action === "reopened" || row.action === "auto_reopened" || row.action === "reintroduced") {
        dependabot.reopened += count;
      }
      if (row.action === "reintroduced") dependabot.reintroduced += count;
    } else if (row.event === "secret_scanning_alert") {
      if (row.action === "created") secretScanning.discovered += count;
      if (row.action === "resolved") secretScanning.remediated += count;
      if (row.action === "reopened") secretScanning.reopened += count;
    }
  }

  const dependabotClosed = dependabot.remediated + dependabot.dismissed;
  dependabot.patchRateClosed = dependabotClosed > 0 ? dependabot.remediated / dependabotClosed : null;

  return {
    totalEvents,
    discovered: codeScanning.discovered + dependabot.discovered + secretScanning.discovered,
    remediated: codeScanning.remediated + dependabot.remediated + secretScanning.remediated,
    dismissed: codeScanning.dismissed + dependabot.dismissed,
    reopened: codeScanning.reopened + dependabot.reopened + secretScanning.reopened,
    codeScanning,
    dependabot,
    secretScanning,
  };
}

function cutoffIso(days: number): { days: number; since: string } {
  const safeDays = Math.min(365, Math.max(1, Math.floor(days)));
  return {
    days: safeDays,
    since: new Date(Date.now() - safeDays * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function getSecurityActivity(
  env: Env,
  repo: string | null,
  requestedDays = 30,
): Promise<Record<string, unknown>> {
  if (!env.STATS_DB) return { available: false, reason: "d1-not-bound" };
  const { days, since } = cutoffIso(requestedDays);
  try {
    const repoClause = repo ? " AND repo = ?" : "";
    const groupedStatement = env.STATS_DB.prepare(
      `SELECT repo, event, action, COUNT(*) AS count
         FROM security_events
        WHERE received_at >= ?${repoClause}
        GROUP BY repo, event, action`,
    );
    const grouped = repo
      ? await groupedStatement.bind(since, repo).all<SecurityCountRow>()
      : await groupedStatement.bind(since).all<SecurityCountRow>();

    const firstStatement = env.STATS_DB.prepare(
      `SELECT MIN(received_at) AS first_recorded_at
         FROM security_events
        WHERE 1 = 1${repoClause}`,
    );
    const first = repo
      ? await firstStatement.bind(repo).first<FirstRecordedRow>()
      : await firstStatement.first<FirstRecordedRow>();

    const recentStatement = env.STATS_DB.prepare(
      `SELECT repo, event, alert_number, action, severity, subject, resolution, received_at
         FROM security_events
        WHERE received_at >= ?${repoClause}
        ORDER BY received_at DESC
        LIMIT 12`,
    );
    const recent = repo
      ? await recentStatement.bind(since, repo).all<RecentSecurityRow>()
      : await recentStatement.bind(since).all<RecentSecurityRow>();

    const rows = grouped.results ?? [];
    const totals = summarizeSecurityRows(rows);
    const byRepo: Record<string, SecurityActivityTotals> = {};
    if (!repo) {
      const groupedByRepo = new Map<string, SecurityCountRow[]>();
      for (const row of rows) {
        const list = groupedByRepo.get(row.repo) ?? [];
        list.push(row);
        groupedByRepo.set(row.repo, list);
      }
      for (const [name, repoRows] of groupedByRepo) byRepo[name] = summarizeSecurityRows(repoRows);
    }

    return {
      available: true,
      days,
      since,
      firstRecordedAt: first?.first_recorded_at ?? null,
      ...totals,
      ...(repo ? {} : { byRepo }),
      recent: (recent.results ?? []).map((row) => ({
        repo: row.repo,
        event: row.event,
        alertNumber: row.alert_number,
        action: row.action,
        severity: row.severity,
        subject: row.subject,
        resolution: row.resolution,
        receivedAt: row.received_at,
      })),
    };
  } catch (error) {
    return {
      available: false,
      reason: "security-events-unavailable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
