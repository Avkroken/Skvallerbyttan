import type { Env } from "./env";
import {
  CloudflareApiError,
  getCloudflareAccount,
  getCloudflareAccessApplications,
  getCloudflareAuditLogs,
  getCloudflareD1Databases,
  getCloudflareKvNamespaces,
  getCloudflareR2Buckets,
  getCloudflareTunnels,
  getCloudflareWorkers,
  getCloudflareZones,
} from "./cloudflare";
import {
  getGitHubOrganizationGovernance,
  getGitHubRepositoryEffectivePolicy,
} from "./github-governance";
import { getCapabilities, recordCapabilityObservation } from "./capabilities";
import { getProviderHealth } from "./provider-health";
import {
  activityFromCloudflareAudit,
  getObservedActivity,
  pruneObservedActivity,
  recordObservedActivity,
} from "./activity";
import { getReadTelemetry, recordReadTelemetry, type ReadConsumer } from "./telemetry";
import {
  readSourceCache,
  sourceCacheAgeMs,
  sourceCacheInvalidated,
  writeSourceCache,
  type SourceCacheKind,
} from "./source-cache";
import { singleFlight } from "./single-flight";

const MINUTE = 60_000;
const EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const REPO_NAME = /^[A-Za-z0-9_.-]+$/;

type TelemetryMeta = {
  capability: string;
  provider: "github" | "cloudflare" | "internal";
  consumer: ReadConsumer;
};

function json(value: unknown, status = 200, headers?: HeadersInit): Response {
  const output = new Headers(headers);
  output.set("Content-Type", "application/json; charset=utf-8");
  output.set("Cache-Control", "private, no-store");
  output.set("X-Content-Type-Options", "nosniff");
  output.set("X-Skvallerbyttan-Schema-Version", "1");
  return new Response(JSON.stringify(value), { status, headers: output });
}

function validRepo(value: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    return null;
  }
  return REPO_NAME.test(decoded) && decoded !== "." && decoded !== ".." ? decoded : null;
}

function telemetry(
  env: Env,
  meta: TelemetryMeta,
  operation: string,
  result: "ok" | "error" | "permission_denied" | "stale",
  cache: "hit" | "stale" | "miss" | "none",
  startedAt: number,
): void {
  recordReadTelemetry(env, {
    capability: meta.capability,
    provider: meta.provider,
    consumer: meta.consumer,
    operation,
    result,
    cache,
    durationMs: Date.now() - startedAt,
  });
}

async function refresh<T>(
  env: Env,
  key: string,
  kind: SourceCacheKind,
  meta: TelemetryMeta,
  loader: () => Promise<T>,
  consumer: ReadConsumer,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const value = await loader();
    await writeSourceCache(env, key, kind, value);
    telemetry(env, { ...meta, consumer }, "refresh", "ok", "miss", startedAt);
    return value;
  } catch (error) {
    telemetry(
      env,
      { ...meta, consumer },
      "refresh",
      error instanceof CloudflareApiError && (error.status === 401 || error.status === 403)
        ? "permission_denied"
        : "error",
      "miss",
      startedAt,
    );
    throw error;
  }
}

function refreshSingleFlight<T>(
  env: Env,
  key: string,
  kind: SourceCacheKind,
  meta: TelemetryMeta,
  loader: () => Promise<T>,
  consumer: ReadConsumer,
): Promise<T> {
  return singleFlight(key, () => refresh(env, key, kind, meta, loader, consumer)) as Promise<T>;
}

async function cached<T>(
  env: Env,
  context: ExecutionContext,
  key: string,
  kind: SourceCacheKind,
  ttlMs: number,
  meta: TelemetryMeta,
  loader: () => Promise<T>,
): Promise<Response> {
  const readStartedAt = Date.now();
  try {
    const existing = await readSourceCache<T>(env, key);
    if (existing) {
      const ageMs = sourceCacheAgeMs(existing.refreshedAt);
      const invalidated = sourceCacheInvalidated(existing);
      const stale = invalidated || ageMs > ttlMs;
      telemetry(env, meta, "serve", stale ? "stale" : "ok", stale ? "stale" : "hit", readStartedAt);
      if (stale) {
        context.waitUntil(
          refreshSingleFlight(
            env,
            key,
            kind,
            meta,
            loader,
            "background_refresh",
          ).catch((error) => {
            console.error("observation background refresh failed", {
              key,
              error: error instanceof Error ? error.message : String(error),
            });
          }),
        );
      }
      return json(existing.value, 200, {
        "X-Skvallerbyttan-Cache": stale ? "stale" : "hit",
        "X-Skvallerbyttan-Cache-Age": String(Math.floor(ageMs / 1000)),
        "X-Skvallerbyttan-Cache-Refreshed-At": existing.refreshedAt,
        "X-Skvallerbyttan-Cache-Ttl": String(Math.floor(ttlMs / 1000)),
        ...(invalidated && existing.invalidationReason
          ? { "X-Skvallerbyttan-Cache-Invalidation": existing.invalidationReason }
          : {}),
      });
    }
  } catch (error) {
    console.error("observation source cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const value = await refreshSingleFlight(env, key, kind, meta, loader, meta.consumer);
  return json(value, 200, {
    "X-Skvallerbyttan-Cache": "miss",
    "X-Skvallerbyttan-Cache-Age": "0",
    "X-Skvallerbyttan-Cache-Ttl": String(Math.floor(ttlMs / 1000)),
  });
}

async function cloudflareRead<T>(
  env: Env,
  capability: string,
  loader: () => Promise<T>,
): Promise<T | Record<string, unknown>> {
  try {
    const value = await loader();
    await recordCapabilityObservation(env, capability, {
      status: "available",
      permissionState: "granted",
      dataState: "available",
      httpStatus: 200,
    });
    return value;
  } catch (error) {
    if (error instanceof CloudflareApiError) {
      const denied = error.status === 401 || error.status === 403;
      const unconfigured = error.status === 503;
      await recordCapabilityObservation(env, capability, {
        status: denied ? "permission_denied" : unconfigured ? "not_configured" : "error",
        permissionState: denied ? "permission_denied" : "unknown",
        dataState: denied ? "unavailable" : unconfigured ? "not_configured" : "error",
        httpStatus: error.status,
        error: error.message,
      });
      return {
        schemaVersion: 1,
        available: false,
        status: denied ? "permission_denied" : unconfigured ? "not_configured" : "error",
        httpStatus: error.status,
        reason: denied ? "Required read permission is not granted." : error.message,
      };
    }
    await recordCapabilityObservation(env, capability, {
      status: "error",
      permissionState: "unknown",
      dataState: "error",
      httpStatus: 0,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      schemaVersion: 1,
      available: false,
      status: "error",
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function auditItems(value: unknown): Record<string, unknown>[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const items = (value as Record<string, unknown>).items;
  return Array.isArray(items)
    ? items.filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object" && !Array.isArray(item)))
    : [];
}

export async function reconcileObservationSources(env: Env): Promise<void> {
  const tasks: Array<Promise<unknown>> = [
    refreshSingleFlight(
      env,
      "github:org:governance",
      "governance",
      {
        capability: "github.avkroken.organization.actions_permissions",
        provider: "github",
        consumer: "reconciliation",
      },
      () => getGitHubOrganizationGovernance(env),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:account",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.account",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.account", () => getCloudflareAccount(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:workers",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.workers",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.workers", () => getCloudflareWorkers(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:zones",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.zones",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.zones", () => getCloudflareZones(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:storage:d1",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.storage.d1",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.storage.d1", () => getCloudflareD1Databases(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:storage:kv",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.storage.kv",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.storage.kv", () => getCloudflareKvNamespaces(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:storage:r2",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.storage.r2",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.storage.r2", () => getCloudflareR2Buckets(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:zero-trust:access",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.zero_trust.access",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.zero_trust.access", () => getCloudflareAccessApplications(env)),
      "reconciliation",
    ),
    refreshSingleFlight(
      env,
      "cloudflare:zero-trust:tunnels",
      "cloudflare",
      {
        capability: "cloudflare.avkroken.zero_trust.tunnels",
        provider: "cloudflare",
        consumer: "reconciliation",
      },
      () => cloudflareRead(env, "cloudflare.avkroken.zero_trust.tunnels", () => getCloudflareTunnels(env)),
      "reconciliation",
    ),
  ];

  for (const task of tasks) {
    try {
      await task;
    } catch (error) {
      console.error("observation reconciliation source failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const audit = await cloudflareRead(
      env,
      "cloudflare.avkroken.audit_logs",
      () => getCloudflareAuditLogs(env, 1),
    );
    for (const item of auditItems(audit).slice(0, 20)) {
      const event = activityFromCloudflareAudit(item);
      if (event) await recordObservedActivity(env, event);
    }
  } catch (error) {
    console.error("audit activity reconciliation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await pruneObservedActivity(env, new Date(Date.now() - EVENT_RETENTION_MS).toISOString());
}

export async function handleObservationApi(
  request: Request,
  env: Env,
  context: ExecutionContext,
  consumer: ReadConsumer,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/v1/")) return null;

  if (request.method !== "GET") {
    return json({ schemaVersion: 1, error: "method_not_allowed" }, 405, { Allow: "GET" });
  }

  if (url.pathname === "/api/v1/capabilities") {
    const value = await getCapabilities(env);
    return json({ ...value, providerHealth: getProviderHealth(env) });
  }

  if (url.pathname === "/api/v1/provider-health") {
    return json(getProviderHealth(env));
  }

  if (url.pathname === "/api/v1/github/org/state") {
    return cached(
      env,
      context,
      "github:org:governance",
      "governance",
      5 * MINUTE,
      {
        capability: "github.avkroken.organization.actions_permissions",
        provider: "github",
        consumer,
      },
      () => getGitHubOrganizationGovernance(env),
    );
  }

  const effectiveMatch = url.pathname.match(/^\/api\/v1\/github\/repos\/([^/]+)\/effective-policy$/);
  if (effectiveMatch) {
    const repo = validRepo(effectiveMatch[1]);
    if (!repo) return json({ schemaVersion: 1, error: "invalid_repository_name" }, 400);
    return cached(
      env,
      context,
      `github:repo:${repo}:effective-policy`,
      "governance",
      5 * MINUTE,
      {
        capability: "github.avkroken.repositories.effective_rulesets",
        provider: "github",
        consumer,
      },
      () => getGitHubRepositoryEffectivePolicy(env, repo),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/account") {
    return cached(
      env,
      context,
      "cloudflare:account",
      "cloudflare",
      15 * MINUTE,
      { capability: "cloudflare.avkroken.account", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.account", () => getCloudflareAccount(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/zones") {
    return cached(
      env,
      context,
      "cloudflare:zones",
      "cloudflare",
      15 * MINUTE,
      { capability: "cloudflare.avkroken.zones", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.zones", () => getCloudflareZones(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/workers") {
    return cached(
      env,
      context,
      "cloudflare:workers",
      "cloudflare",
      10 * MINUTE,
      { capability: "cloudflare.avkroken.workers", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.workers", () => getCloudflareWorkers(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/storage/d1") {
    return cached(
      env,
      context,
      "cloudflare:storage:d1",
      "cloudflare",
      30 * MINUTE,
      { capability: "cloudflare.avkroken.storage.d1", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.storage.d1", () => getCloudflareD1Databases(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/storage/kv") {
    return cached(
      env,
      context,
      "cloudflare:storage:kv",
      "cloudflare",
      30 * MINUTE,
      { capability: "cloudflare.avkroken.storage.kv", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.storage.kv", () => getCloudflareKvNamespaces(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/storage/r2") {
    return cached(
      env,
      context,
      "cloudflare:storage:r2",
      "cloudflare",
      30 * MINUTE,
      { capability: "cloudflare.avkroken.storage.r2", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.storage.r2", () => getCloudflareR2Buckets(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/zero-trust/access") {
    return cached(
      env,
      context,
      "cloudflare:zero-trust:access",
      "cloudflare",
      15 * MINUTE,
      { capability: "cloudflare.avkroken.zero_trust.access", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.zero_trust.access", () => getCloudflareAccessApplications(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/zero-trust/tunnels") {
    return cached(
      env,
      context,
      "cloudflare:zero-trust:tunnels",
      "cloudflare",
      15 * MINUTE,
      { capability: "cloudflare.avkroken.zero_trust.tunnels", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.zero_trust.tunnels", () => getCloudflareTunnels(env)),
    );
  }

  if (url.pathname === "/api/v1/cloudflare/audit") {
    const days = Number(url.searchParams.get("days") ?? "7");
    const safeDays = Number.isFinite(days) ? Math.min(30, Math.max(1, Math.trunc(days))) : 7;
    return cached(
      env,
      context,
      `cloudflare:audit:${safeDays}d`,
      "cloudflare",
      10 * MINUTE,
      { capability: "cloudflare.avkroken.audit_logs", provider: "cloudflare", consumer },
      () => cloudflareRead(env, "cloudflare.avkroken.audit_logs", () => getCloudflareAuditLogs(env, safeDays)),
    );
  }

  if (url.pathname === "/api/v1/activity") {
    const days = Number(url.searchParams.get("days") ?? "30");
    const value = await getObservedActivity(env, {
      days: Number.isFinite(days) ? days : 30,
      provider: url.searchParams.get("provider"),
      capability: url.searchParams.get("capability"),
      repository: url.searchParams.get("repository"),
      resource: url.searchParams.get("resource"),
    });
    recordReadTelemetry(env, {
      capability: "internal.activity",
      provider: "internal",
      consumer,
      operation: "query",
      result: (value as { available?: boolean }).available === false ? "error" : "ok",
      cache: "none",
      durationMs: 0,
    });
    return json(value);
  }

  if (url.pathname === "/api/v1/reads") {
    const days = Number(url.searchParams.get("days") ?? "30");
    const value = await getReadTelemetry(env, Number.isFinite(days) ? days : 30);
    const status = (value as { status?: string }).status;
    await recordCapabilityObservation(env, "cloudflare.avkroken.telemetry", {
      status: status === "available" ? "available" : status === "permission_denied" ? "permission_denied" : status === "not_configured" ? "not_configured" : "error",
      permissionState: status === "available" ? "granted" : status === "permission_denied" ? "permission_denied" : "unknown",
      dataState: status === "available" ? "available" : status === "not_configured" ? "not_configured" : "unavailable",
      httpStatus: typeof (value as { httpStatus?: unknown }).httpStatus === "number"
        ? Number((value as { httpStatus: number }).httpStatus)
        : status === "available" ? 200 : null,
      error: typeof (value as { reason?: unknown }).reason === "string" ? String((value as { reason: string }).reason) : null,
    });
    return json(value);
  }

  return json({ schemaVersion: 1, error: "not_found" }, 404);
}
