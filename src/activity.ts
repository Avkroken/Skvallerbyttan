import type { Env } from "./env";

export type ActivityCoverage =
  | "complete"
  | "partial"
  | "sampled"
  | "since_installation"
  | "since_first_observation"
  | "unknown";

export type ActivitySource = "webhook" | "audit_log" | "snapshot_diff" | "reconciliation";

export type ObservedActivityEvent = {
  eventKey: string;
  provider: "github" | "cloudflare";
  capability: string;
  source: ActivitySource;
  coverage: ActivityCoverage;
  event: string;
  action: string | null;
  resourceType: string | null;
  resourceId: string | null;
  repository: string | null;
  occurredAt: string | null;
  receivedAt: string;
};

type ActivityGroupRow = {
  provider: string;
  capability: string;
  event: string;
  count: number;
};

type ActivityCoverageRow = {
  provider: string;
  capability: string;
  source: string;
  coverage: ActivityCoverage;
  first_observed_at: string | null;
  last_observed_at: string | null;
  count: number;
};

type ActivityEventRow = {
  provider: string;
  capability: string;
  source: string;
  coverage: ActivityCoverage;
  event: string;
  action: string | null;
  resource_type: string | null;
  resource_id: string | null;
  repository: string | null;
  occurred_at: string | null;
  received_at: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 180) : null;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function githubCapability(event: string): string {
  if (event.startsWith("pull_request")) return "github.avkroken.pull_requests";
  if (event === "issues" || event === "issue_comment") return "github.avkroken.pull_requests";
  if (event.includes("workflow") || event === "check_run" || event === "check_suite" || event === "status") {
    return "github.avkroken.actions";
  }
  if (event.includes("scanning") || event === "dependabot_alert") return "github.avkroken.security";
  if (event === "repository_ruleset" || event === "branch_protection_rule") {
    return "github.avkroken.repositories.effective_rulesets";
  }
  return "github.avkroken.repositories";
}

function githubResourceId(payload: Record<string, unknown>): string | null {
  const candidates = [
    record(payload.workflow_run)?.id,
    record(payload.pull_request)?.number,
    record(payload.issue)?.number,
    record(payload.alert)?.number,
    record(payload.ruleset)?.id,
    record(payload.release)?.id,
    record(payload.deployment)?.id,
    record(payload.repository)?.id,
  ];
  for (const value of candidates) {
    if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 120);
  }
  return null;
}

export function activityFromGitHubWebhook(
  deliveryId: string,
  event: string,
  repository: string | null,
  payload: Record<string, unknown>,
  receivedAt = new Date().toISOString(),
): ObservedActivityEvent {
  const capability = githubCapability(event);
  return {
    eventKey: `github:${deliveryId}:${capability}`,
    provider: "github",
    capability,
    source: "webhook",
    coverage: "since_first_observation",
    event,
    action: text(payload.action),
    resourceType: event,
    resourceId: githubResourceId(payload),
    repository,
    occurredAt: null,
    receivedAt,
  };
}

export function activityFromCloudflareWebhook(input: {
  deliveryId: string;
  source: "notifications" | "casb";
  eventType: string;
  eventId: string | null;
  state: string | null;
  occurredAt: string | null;
  receivedAt: string;
}): ObservedActivityEvent {
  const capability = input.source === "notifications"
    ? "cloudflare.avkroken.notifications"
    : "cloudflare.avkroken.zero_trust";
  return {
    eventKey: `cloudflare:${input.deliveryId}:${capability}`,
    provider: "cloudflare",
    capability,
    source: "webhook",
    coverage: "since_first_observation",
    event: input.eventType,
    action: input.state,
    resourceType: input.source,
    resourceId: input.eventId,
    repository: null,
    occurredAt: input.occurredAt,
    receivedAt: input.receivedAt,
  };
}

export function activityFromCloudflareAudit(
  value: Record<string, unknown>,
  receivedAt = new Date().toISOString(),
): ObservedActivityEvent | null {
  const id = text(value.id);
  if (!id) return null;
  const action = record(value.action);
  const resource = record(value.resource);
  const product = text(resource?.product)?.toLowerCase() || "";
  const resourceType = text(resource?.type);
  const lowerType = resourceType?.toLowerCase() || "";
  const capability = product.includes("d1") || lowerType.includes("d1")
    ? "cloudflare.avkroken.storage.d1"
    : product.includes("kv") || lowerType.includes("kv")
      ? "cloudflare.avkroken.storage.kv"
      : product.includes("r2") || lowerType.includes("r2")
        ? "cloudflare.avkroken.storage.r2"
        : product.includes("access") || lowerType.includes("access")
          ? "cloudflare.avkroken.zero_trust.access"
          : product.includes("tunnel") || product.includes("connector") || lowerType.includes("tunnel")
            ? "cloudflare.avkroken.zero_trust.tunnels"
            : product.includes("gateway") || product.includes("zero")
              ? "cloudflare.avkroken.zero_trust"
              : product.includes("zone") || lowerType.includes("zone")
                ? "cloudflare.avkroken.zones"
                : product.includes("worker") || lowerType.includes("worker")
                  ? "cloudflare.avkroken.workers"
                  : "cloudflare.avkroken.account";
  return {
    eventKey: `cloudflare:audit:${id}`,
    provider: "cloudflare",
    capability,
    source: "audit_log",
    coverage: "partial",
    event: text(action?.type) || "audit",
    action: text(action?.result),
    resourceType,
    resourceId: text(resource?.id),
    repository: null,
    occurredAt: text(action?.time),
    receivedAt,
  };
}

export async function recordObservedActivity(env: Env, event: ObservedActivityEvent): Promise<boolean> {
  if (!env.STATS_DB) return false;
  try {
    const result = await env.STATS_DB.prepare(
      `INSERT OR IGNORE INTO observation_events (
         event_key, provider, capability, source, coverage, event, action,
         resource_type, resource_id, repository, occurred_at, received_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      event.eventKey,
      event.provider,
      event.capability,
      event.source,
      event.coverage,
      event.event,
      event.action,
      event.resourceType,
      event.resourceId,
      event.repository,
      event.occurredAt,
      event.receivedAt,
    ).run();
    return Number(result.meta.changes ?? 0) > 0;
  } catch (error) {
    console.error("observation activity write failed", {
      capability: event.capability,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function pruneObservedActivity(env: Env, olderThanIso: string): Promise<void> {
  if (!env.STATS_DB) return;
  try {
    await env.STATS_DB.prepare(
      `DELETE FROM observation_events WHERE received_at < ?`,
    ).bind(olderThanIso).run();
  } catch (error) {
    console.error("observation activity prune failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function boundedDays(value: number): number {
  return Math.min(90, Math.max(1, Math.trunc(Number.isFinite(value) ? value : 30)));
}

export async function getObservedActivity(
  env: Env,
  input: {
    days?: number;
    provider?: string | null;
    capability?: string | null;
    repository?: string | null;
    resource?: string | null;
  } = {},
): Promise<Record<string, unknown>> {
  if (!env.STATS_DB) return { schemaVersion: 1, available: false, status: "not_configured", reason: "d1-not-bound" };
  const days = boundedDays(input.days ?? 30);
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const clauses = ["received_at >= ?"];
  const values: unknown[] = [from];

  const add = (column: string, value: string | null | undefined) => {
    if (!value) return;
    clauses.push(`${column} = ?`);
    values.push(value);
  };
  add("provider", input.provider);
  add("capability", input.capability);
  add("repository", input.repository);
  if (input.resource) {
    clauses.push("(resource_type = ? OR resource_id = ?)");
    values.push(input.resource, input.resource);
  }
  const where = clauses.join(" AND ");

  try {
    const [grouped, coverage, recent] = await Promise.all([
      env.STATS_DB.prepare(
        `SELECT provider, capability, event, COUNT(*) AS count
           FROM observation_events
          WHERE ${where}
          GROUP BY provider, capability, event
          ORDER BY count DESC, provider, capability, event`,
      ).bind(...values).all<ActivityGroupRow>(),
      env.STATS_DB.prepare(
        `SELECT provider, capability, source, coverage,
                MIN(received_at) AS first_observed_at,
                MAX(received_at) AS last_observed_at,
                COUNT(*) AS count
           FROM observation_events
          WHERE ${where}
          GROUP BY provider, capability, source, coverage
          ORDER BY provider, capability, source, coverage`,
      ).bind(...values).all<ActivityCoverageRow>(),
      env.STATS_DB.prepare(
        `SELECT provider, capability, source, coverage, event, action, resource_type,
                resource_id, repository, occurred_at, received_at
           FROM observation_events
          WHERE ${where}
          ORDER BY received_at DESC
          LIMIT 100`,
      ).bind(...values).all<ActivityEventRow>(),
    ]);

    return {
      schemaVersion: 1,
      available: true,
      status: "available",
      period: { days, from, to: new Date().toISOString() },
      grouped: (grouped.results ?? []).map((row) => ({
        provider: row.provider,
        capability: row.capability,
        event: row.event,
        observedCount: Number(row.count),
      })),
      coverage: (coverage.results ?? []).map((row) => ({
        provider: row.provider,
        capability: row.capability,
        source: row.source,
        coverage: row.coverage,
        firstObservedAt: row.first_observed_at,
        lastObservedAt: row.last_observed_at,
        periodComplete: false,
        sampling: "none",
        observedCount: Number(row.count),
      })),
      recent: (recent.results ?? []).map((row) => ({
        provider: row.provider,
        capability: row.capability,
        source: row.source,
        coverage: row.coverage,
        event: row.event,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        repository: row.repository,
        occurredAt: row.occurred_at,
        receivedAt: row.received_at,
      })),
    };
  } catch (error) {
    return {
      schemaVersion: 1,
      available: false,
      status: "error",
      reason: "activity_query_failed",
    };
  }
}
