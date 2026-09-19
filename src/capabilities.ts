import type { Env } from "./env";
import {
  effectiveStatus,
  freshnessFromTimestamp,
  statusFromHttp,
  type Freshness,
  type ObservationStatus,
  type PermissionState,
  type Provider,
  type ProviderSupport,
} from "./observation-model";

export type CapabilityDefinition = {
  key: string;
  name: string;
  provider: Provider;
  scope: "organization" | "repository" | "account";
  implemented: boolean;
  providerSupport: ProviderSupport;
  endpoint: string;
  permission: string;
  permissionLevel: "read" | "write-required-for-provider-read" | "not-required";
  readOnlyBlocked?: boolean;
  supports: string[];
  cacheTtlMs: number;
};

export type CapabilityObservation = CapabilityDefinition & {
  status: ObservationStatus;
  permissionState: PermissionState;
  dataState: ObservationStatus;
  freshness: Freshness;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastHttpStatus: number | null;
  lastError: string | null;
};

type CapabilityRow = {
  capability_key: string;
  status: ObservationStatus;
  permission_state: PermissionState;
  data_state: ObservationStatus;
  last_attempt_at: string | null;
  last_success_at: string | null;
  last_http_status: number | null;
  last_error: string | null;
};

const MINUTE = 60_000;

export const CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  {
    key: "github.avkroken.repositories",
    name: "Repositories",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/repos",
    permission: "Metadata / repository access",
    permissionLevel: "read",
    supports: ["list", "detail"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "github.avkroken.pull_requests",
    name: "Pull requests och issues",
    provider: "github",
    scope: "repository",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /repos/{owner}/{repo}/pulls + issues",
    permission: "Pull requests: read, Issues: read",
    permissionLevel: "read",
    supports: ["list", "activity"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "github.avkroken.actions",
    name: "Actions",
    provider: "github",
    scope: "repository",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /repos/{owner}/{repo}/actions/*",
    permission: "Actions: read",
    permissionLevel: "read",
    supports: ["workflows", "runs", "health"],
    cacheTtlMs: 10 * MINUTE,
  },
  {
    key: "github.avkroken.organization.actions_permissions",
    name: "Organization Actions permissions",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/actions/permissions*",
    permission: "Administration (organization): read",
    permissionLevel: "read",
    supports: ["permissions", "allowed_actions", "workflow_permissions"],
    cacheTtlMs: 5 * MINUTE,
  },
  {
    key: "github.avkroken.organization.actions_policies",
    name: "Workflow Execution Protections",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/actions/policies",
    permission: "Administration (organization): write",
    permissionLevel: "write-required-for-provider-read",
    readOnlyBlocked: true,
    supports: ["provider_declared_but_blocked"],
    cacheTtlMs: 5 * MINUTE,
  },
  {
    key: "github.avkroken.organization.rulesets",
    name: "Organization rulesets",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/rulesets",
    permission: "Administration (organization): write",
    permissionLevel: "write-required-for-provider-read",
    readOnlyBlocked: true,
    supports: ["provider_declared_but_blocked"],
    cacheTtlMs: 5 * MINUTE,
  },
  {
    key: "github.avkroken.repositories.effective_rulesets",
    name: "Effective repository rulesets",
    provider: "github",
    scope: "repository",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /repos/{owner}/{repo}/rulesets?includes_parents=true",
    permission: "Metadata (repository): read",
    permissionLevel: "read",
    supports: ["list", "detail", "effective_state", "provenance"],
    cacheTtlMs: 5 * MINUTE,
  },
  {
    key: "github.avkroken.custom_properties",
    name: "Custom Properties",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/properties/schema + /properties/values",
    permission: "Custom properties (organization): read",
    permissionLevel: "read",
    supports: ["definitions", "assignments", "filter"],
    cacheTtlMs: 5 * MINUTE,
  },
  {
    key: "github.avkroken.security",
    name: "Security alerts",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/{code-scanning|dependabot|secret-scanning}/alerts",
    permission: "Security events / Dependabot alerts: read",
    permissionLevel: "read",
    supports: ["code_scanning", "dependabot", "secret_scanning", "activity"],
    cacheTtlMs: 10 * MINUTE,
  },
  {
    key: "github.avkroken.security_configurations",
    name: "Security configurations",
    provider: "github",
    scope: "organization",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /orgs/{org}/code-security/configurations",
    permission: "Administration (organization): read",
    permissionLevel: "read",
    supports: ["list", "defaults", "repository_effective"],
    cacheTtlMs: 5 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.account",
    name: "Account",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}",
    permission: "Account Settings: read",
    permissionLevel: "read",
    supports: ["detail", "health"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.zones",
    name: "Zones",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /zones?account.id={account_id}",
    permission: "Zone: read",
    permissionLevel: "read",
    supports: ["list", "status"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.workers",
    name: "Workers",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/workers/scripts",
    permission: "Workers Scripts: read",
    permissionLevel: "read",
    supports: ["list", "metadata", "routes", "observability"],
    cacheTtlMs: 10 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.storage.d1",
    name: "D1 databases",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/d1/database",
    permission: "D1 Read",
    permissionLevel: "read",
    supports: ["list", "metadata"],
    cacheTtlMs: 30 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.storage.kv",
    name: "KV namespaces",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/storage/kv/namespaces",
    permission: "Workers KV Storage Read",
    permissionLevel: "read",
    supports: ["list", "metadata"],
    cacheTtlMs: 30 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.storage.r2",
    name: "R2 buckets",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/r2/buckets",
    permission: "Workers R2 Storage Read",
    permissionLevel: "read",
    supports: ["list", "metadata"],
    cacheTtlMs: 30 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.zero_trust.access",
    name: "Access applications",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/access/apps",
    permission: "Access: Apps and Policies Read",
    permissionLevel: "read",
    supports: ["applications", "policy_metadata"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.zero_trust.tunnels",
    name: "Tunnels",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/tunnels",
    permission: "Cloudflare Tunnel Read or Cloudflare One Connectors Read",
    permissionLevel: "read",
    supports: ["list", "health", "type"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.zero_trust",
    name: "Zero Trust",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/access/* + /data-security/posture/*",
    permission: "Zero Trust: read",
    permissionLevel: "read",
    supports: ["casb_webhooks"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.notifications",
    name: "Notifications",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/alerting/v3/*",
    permission: "Notifications: read",
    permissionLevel: "read",
    supports: ["policies", "history", "webhooks", "activity"],
    cacheTtlMs: 15 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.audit_logs",
    name: "Audit Logs",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "GET /accounts/{account_id}/logs/audit",
    permission: "Account Settings: read",
    permissionLevel: "read",
    supports: ["recent", "activity"],
    cacheTtlMs: 10 * MINUTE,
  },
  {
    key: "cloudflare.avkroken.telemetry",
    name: "Read telemetry",
    provider: "cloudflare",
    scope: "account",
    implemented: true,
    providerSupport: "supported",
    endpoint: "POST /accounts/{account_id}/analytics_engine/sql (SELECT only)",
    permission: "Account Analytics: read",
    permissionLevel: "read",
    supports: ["reads", "latency", "cache_hit", "consumer"],
    cacheTtlMs: 5 * MINUTE,
  },
] as const;

function definition(key: string): CapabilityDefinition | undefined {
  return CAPABILITY_DEFINITIONS.find((item) => item.key === key);
}

export async function recordCapabilityObservation(
  env: Env,
  key: string,
  input: {
    status?: ObservationStatus;
    permissionState?: PermissionState;
    dataState?: ObservationStatus;
    httpStatus?: number | null;
    error?: string | null;
    at?: string;
  },
): Promise<void> {
  if (!env.STATS_DB || !definition(key)) return;
  const at = input.at ?? new Date().toISOString();
  const classified = input.httpStatus == null ? null : statusFromHttp(input.httpStatus);
  const status = input.status ?? classified?.status ?? "unknown";
  const permissionState = input.permissionState ?? classified?.permissionState ?? "unknown";
  const dataState = input.dataState ?? classified?.dataState ?? "unknown";
  const success = status === "available";
  try {
    await env.STATS_DB.prepare(
      `INSERT INTO capability_observations (
         capability_key, status, permission_state, data_state, last_attempt_at,
         last_success_at, last_http_status, last_error
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(capability_key) DO UPDATE SET
         status = excluded.status,
         permission_state = excluded.permission_state,
         data_state = excluded.data_state,
         last_attempt_at = excluded.last_attempt_at,
         last_success_at = COALESCE(excluded.last_success_at, capability_observations.last_success_at),
         last_http_status = excluded.last_http_status,
         last_error = excluded.last_error`,
    ).bind(
      key,
      status,
      permissionState,
      dataState,
      at,
      success ? at : null,
      input.httpStatus ?? null,
      input.error?.slice(0, 240) ?? null,
    ).run();
  } catch (error) {
    console.error("capability observation write failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getCapabilities(env: Env, nowMs = Date.now()): Promise<{
  schemaVersion: 1;
  generatedAt: string;
  capabilities: CapabilityObservation[];
}> {
  const rows = new Map<string, CapabilityRow>();
  if (env.STATS_DB) {
    try {
      const result = await env.STATS_DB.prepare(
        `SELECT capability_key, status, permission_state, data_state, last_attempt_at,
                last_success_at, last_http_status, last_error
           FROM capability_observations`,
      ).all<CapabilityRow>();
      for (const row of result.results ?? []) rows.set(row.capability_key, row);
    } catch (error) {
      console.error("capability observation read failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date(nowMs).toISOString(),
    capabilities: CAPABILITY_DEFINITIONS.map((item) => {
      if (item.readOnlyBlocked) {
        return {
          ...item,
          status: "permission_denied",
          permissionState: "blocked_by_read_only_policy",
          dataState: "unavailable",
          freshness: "unknown",
          lastAttemptAt: null,
          lastSuccessAt: null,
          lastHttpStatus: null,
          lastError: "Provider requires a write-class permission for this GET endpoint; Skvallerbyttan does not request it.",
        };
      }

      const row = rows.get(item.key);
      const dataState: ObservationStatus = row?.data_state ?? "not_observed";
      const permissionState: PermissionState = row?.permission_state ?? "unknown";
      const freshness = freshnessFromTimestamp(row?.last_success_at ?? null, item.cacheTtlMs, nowMs);
      return {
        ...item,
        status: effectiveStatus({
          implemented: item.implemented,
          providerSupport: item.providerSupport,
          permissionState,
          dataState,
          freshness,
        }),
        permissionState,
        dataState,
        freshness,
        lastAttemptAt: row?.last_attempt_at ?? null,
        lastSuccessAt: row?.last_success_at ?? null,
        lastHttpStatus: row?.last_http_status ?? null,
        lastError: row?.last_error ?? null,
      };
    }),
  };
}
