import type { Env } from "./env";
import { getOverview, getRepositoryDetail } from "./data";
import { GitHubApiError } from "./github";
import {
  handleObservationApi,
  reconcileObservationSources,
} from "./observations-api";
import { authorizeReadRequest } from "./read-access";
import { recordReadTelemetry, type ReadConsumer } from "./telemetry";
import {
  CloudflareApiError,
  cloudflareApiConfigured,
  getCloudflareCasbWebhooks,
  getCloudflareNotificationHistory,
  getCloudflareNotificationPolicies,
  getCloudflareNotificationWebhooks,
} from "./cloudflare";
import { getCloudflareActivity, pruneCloudflareEvents } from "./cloudflare-events";
import {
  handleCloudflareCasbWebhook,
  handleCloudflareNotificationsWebhook,
} from "./cloudflare-webhook";
import { getRepositoryInsights } from "./insights";
import { getSecurityActivity } from "./security-events";
import { singleFlight } from "./single-flight";
import {
  captureOverviewSnapshot,
  getHistory,
  historyConfigured,
  previousOverviewSnapshot,
  sinceLast,
  snapshotFromOverview,
} from "./history";
import {
  pruneWebhookDeliveries,
  readSourceCache,
  sourceCacheAgeMs,
  sourceCacheConfigured,
  sourceCacheInvalidated,
  type SourceCacheKind,
  writeSourceCache,
} from "./source-cache";
import { handleGitHubWebhook } from "./webhook";
import {
  authConfigured,
  authenticatedUserId,
  handleGitHubCallback,
  loginPage,
  logout,
  startGitHubLogin,
} from "./auth";

const CACHE_MAX_AGE_MS = 6 * 60 * 60 * 1000;
const CLOUDFLARE_CACHE_MAX_AGE_MS = 15 * 60 * 1000;
const WEBHOOK_DELIVERY_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CLOUDFLARE_EVENT_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const REPO_NAME = /^[A-Za-z0-9_.-]+$/;

function legacyApiCapability(pathname: string): {
  capability: string;
  provider: "github" | "cloudflare" | "internal";
} {
  if (pathname === "/api/overview" || pathname.startsWith("/api/repos/") || pathname.startsWith("/api/insights/")) {
    return { capability: "github.avkroken.repositories", provider: "github" };
  }
  if (pathname === "/api/security-activity") {
    return { capability: "github.avkroken.security", provider: "github" };
  }
  if (pathname.startsWith("/api/cloudflare/notifications")) {
    return { capability: "cloudflare.avkroken.notifications", provider: "cloudflare" };
  }
  if (pathname.startsWith("/api/cloudflare/casb")) {
    return { capability: "cloudflare.avkroken.zero_trust", provider: "cloudflare" };
  }
  if (pathname === "/api/cloudflare/activity") {
    return { capability: "internal.activity", provider: "internal" };
  }
  return { capability: "internal.dashboard", provider: "internal" };
}

function recordLegacyApiRead(
  env: Env,
  pathname: string,
  consumer: ReadConsumer,
  response: Response,
  startedAt: number,
): void {
  const meta = legacyApiCapability(pathname);
  const cache = response.headers.get("x-skvallerbyttan-cache");
  recordReadTelemetry(env, {
    capability: meta.capability,
    provider: meta.provider,
    consumer,
    operation: pathname,
    result: response.ok ? (cache === "stale" ? "stale" : "ok") : response.status === 401 || response.status === 403 ? "permission_denied" : "error",
    cache: cache === "hit" || cache === "stale" || cache === "miss" ? cache : "none",
    durationMs: Date.now() - startedAt,
  });
}

function json(value: unknown, status = 200, extraHeaders?: HeadersInit): Response {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("x-content-type-options", "nosniff");
  return new Response(JSON.stringify(value), { status, headers });
}

function configured(env: Env): boolean {
  return Boolean(
    env.SKVALLERBYTTAN_GAMNACKE_CLIENT_ID?.trim() &&
    env.SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY &&
    authConfigured(env),
  );
}

function redirectToLogin(): Response {
  return new Response(null, {
    status: 303,
    headers: {
      Location: "/login",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}

function cacheHeaders(
  state: "hit" | "stale" | "miss",
  refreshedAt: string,
  ageMs: number,
  ttlMs: number,
  reason?: string | null,
): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    "X-Skvallerbyttan-Cache": state,
    "X-Skvallerbyttan-Cache-Age": String(Math.floor(ageMs / 1000)),
    "X-Skvallerbyttan-Cache-Refreshed-At": refreshedAt,
    "X-Skvallerbyttan-Cache-Ttl": String(Math.floor(ttlMs / 1000)),
    ...(reason ? { "X-Skvallerbyttan-Cache-Invalidation": reason } : {}),
  };
}

async function refreshSourceValue(
  env: Env,
  key: string,
  kind: SourceCacheKind,
  loader: () => Promise<unknown>,
): Promise<unknown> {
  const value = await loader();
  try {
    await writeSourceCache(env, key, kind, value);
  } catch (error) {
    console.error("source cache write failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }
  return value;
}

function refreshSourceValueSingleFlight(
  env: Env,
  key: string,
  kind: SourceCacheKind,
  loader: () => Promise<unknown>,
): Promise<unknown> {
  return singleFlight(key, () => refreshSourceValue(env, key, kind, loader));
}

async function sourceCachedJson(
  env: Env,
  context: ExecutionContext,
  key: string,
  kind: SourceCacheKind,
  ttlMs: number,
  loader: () => Promise<unknown>,
): Promise<Response> {
  try {
    const cached = await readSourceCache<unknown>(env, key);
    if (cached) {
      const ageMs = sourceCacheAgeMs(cached.refreshedAt);
      const invalidated = sourceCacheInvalidated(cached);
      const stale = invalidated || ageMs > ttlMs;
      if (stale) {
        context.waitUntil(refreshSourceValueSingleFlight(env, key, kind, loader).catch((error) => {
          console.error("source cache background refresh failed", {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }));
      }
      return json(
        cached.value,
        200,
        cacheHeaders(
          stale ? "stale" : "hit",
          cached.refreshedAt,
          ageMs,
          ttlMs,
          invalidated ? cached.invalidationReason : null,
        ),
      );
    }
  } catch (error) {
    console.error("source cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const value = await refreshSourceValueSingleFlight(env, key, kind, loader);
  const refreshedAt = new Date().toISOString();
  return json(value, 200, cacheHeaders("miss", refreshedAt, 0, ttlMs));
}

function validRepoSegment(value: string): string | null {
  let repo: string;
  try {
    repo = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (!REPO_NAME.test(repo) || repo === "." || repo === "..") return null;
  return repo;
}

async function overviewWithHistory(env: Env, context: ExecutionContext): Promise<Record<string, unknown>> {
  const overview = await getOverview(env);
  if (!historyConfigured(env)) {
    return {
      ...overview,
      history: { available: false, reason: "d1-not-bound" },
      sinceLast: { available: false, reason: "d1-not-bound" },
    };
  }

  const current = snapshotFromOverview(overview);
  let previous = null;
  try {
    previous = await previousOverviewSnapshot(env, current.bucket);
  } catch (error) {
    console.error("statistics history read failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      ...overview,
      history: { available: false, reason: "d1-unavailable" },
      sinceLast: { available: false, reason: "d1-unavailable" },
    };
  }

  context.waitUntil(captureOverviewSnapshot(env, overview).catch((error) => {
    console.error("statistics history write failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }));

  return {
    ...overview,
    history: { available: true, bucket: current.bucket },
    sinceLast: sinceLast(current, previous),
  };
}

async function refreshOverviewCache(env: Env, context: ExecutionContext): Promise<Record<string, unknown>> {
  return await refreshSourceValueSingleFlight(
    env,
    "overview",
    "overview",
    () => overviewWithHistory(env, context),
  ) as Record<string, unknown>;
}

async function scheduledCloudflareRefresh(env: Env): Promise<void> {
  if (!cloudflareApiConfigured(env)) return;
  const sources: Array<[string, () => Promise<Record<string, unknown>>]> = [
    ["cloudflare:notifications:history", () => getCloudflareNotificationHistory(env)],
    ["cloudflare:notifications:policies", () => getCloudflareNotificationPolicies(env)],
    ["cloudflare:notifications:webhooks", () => getCloudflareNotificationWebhooks(env)],
    ["cloudflare:casb:webhooks", () => getCloudflareCasbWebhooks(env)],
  ];

  for (const [key, loader] of sources) {
    try {
      await refreshSourceValueSingleFlight(env, key, "cloudflare", loader);
    } catch (error) {
      console.error("scheduled cloudflare reconciliation failed", {
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

async function scheduledRefresh(env: Env, context: ExecutionContext): Promise<void> {
  if (!sourceCacheConfigured(env)) {
    console.error("scheduled source refresh skipped: STATS_DB is not bound");
    return;
  }

  try {
    await refreshOverviewCache(env, context);
  } catch (error) {
    console.error("scheduled reconciliation refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  await scheduledCloudflareRefresh(env);

  try {
    await reconcileObservationSources(env);
  } catch (error) {
    console.error("observation reconciliation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const cutoff = new Date(Date.now() - WEBHOOK_DELIVERY_RETENTION_MS).toISOString();
    await pruneWebhookDeliveries(env, cutoff);
  } catch (error) {
    console.error("webhook delivery pruning failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }

  try {
    const cutoff = new Date(Date.now() - CLOUDFLARE_EVENT_RETENTION_MS).toISOString();
    await pruneCloudflareEvents(env, cutoff);
  } catch (error) {
    console.error("cloudflare event pruning failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function handleApi(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/overview") {
    return sourceCachedJson(
      env,
      context,
      "overview",
      "overview",
      CACHE_MAX_AGE_MS,
      () => overviewWithHistory(env, context),
    );
  }

  if (url.pathname === "/api/security-activity") {
    const rawRepo = url.searchParams.get("repo");
    const repo = rawRepo === null ? null : validRepoSegment(rawRepo);
    if (rawRepo !== null && repo === null) return json({ error: "invalid repository name" }, 400);
    const days = Number(url.searchParams.get("days") ?? "30");
    return json(
      await getSecurityActivity(env, repo, Number.isFinite(days) ? days : 30),
      200,
      { "Cache-Control": "private, no-store" },
    );
  }

  if (url.pathname === "/api/cloudflare/activity") {
    const days = Number(url.searchParams.get("days") ?? "30");
    return json(
      await getCloudflareActivity(env, Number.isFinite(days) ? days : 30),
      200,
      { "Cache-Control": "private, no-store" },
    );
  }

  if (url.pathname === "/api/cloudflare/notifications/history") {
    return sourceCachedJson(
      env,
      context,
      "cloudflare:notifications:history",
      "cloudflare",
      CLOUDFLARE_CACHE_MAX_AGE_MS,
      () => getCloudflareNotificationHistory(env),
    );
  }

  if (url.pathname === "/api/cloudflare/notifications/policies") {
    return sourceCachedJson(
      env,
      context,
      "cloudflare:notifications:policies",
      "cloudflare",
      CLOUDFLARE_CACHE_MAX_AGE_MS,
      () => getCloudflareNotificationPolicies(env),
    );
  }

  if (url.pathname === "/api/cloudflare/notifications/webhooks") {
    return sourceCachedJson(
      env,
      context,
      "cloudflare:notifications:webhooks",
      "cloudflare",
      CLOUDFLARE_CACHE_MAX_AGE_MS,
      () => getCloudflareNotificationWebhooks(env),
    );
  }

  if (url.pathname === "/api/cloudflare/casb/webhooks") {
    return sourceCachedJson(
      env,
      context,
      "cloudflare:casb:webhooks",
      "cloudflare",
      CLOUDFLARE_CACHE_MAX_AGE_MS,
      () => getCloudflareCasbWebhooks(env),
    );
  }

  if (url.pathname === "/api/history") {
    const rawRepo = url.searchParams.get("repo");
    const repo = rawRepo === null ? null : validRepoSegment(rawRepo);
    if (rawRepo !== null && repo === null) return json({ error: "invalid repository name" }, 400);
    const days = Number(url.searchParams.get("days") ?? "90");
    try {
      return json(await getHistory(env, repo, Number.isFinite(days) ? days : 90), 200, { "Cache-Control": "private, max-age=0" });
    } catch (error) {
      console.error("statistics history query failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return json({ available: false, reason: "d1-unavailable", points: [] }, 200, { "Cache-Control": "private, max-age=0" });
    }
  }

  const insightMatch = url.pathname.match(/^\/api\/insights\/([^/]+)$/);
  if (insightMatch) {
    const repo = validRepoSegment(insightMatch[1]);
    if (!repo) return json({ error: "invalid repository name" }, 400);
    return sourceCachedJson(
      env,
      context,
      `insights:${repo}`,
      "insights",
      CACHE_MAX_AGE_MS,
      () => getRepositoryInsights(env, repo),
    );
  }

  const match = url.pathname.match(/^\/api\/repos\/([^/]+)$/);
  if (match) {
    const repo = validRepoSegment(match[1]);
    if (!repo) return json({ error: "invalid repository name" }, 400);
    return sourceCachedJson(
      env,
      context,
      `repository:${repo}`,
      "repository",
      CACHE_MAX_AGE_MS,
      () => getRepositoryDetail(env, repo),
    );
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/webhook") {
      return json(
        { error: "legacy webhook endpoint removed", endpoint: "/webhooks/github" },
        410,
        { "Cache-Control": "no-store" },
      );
    }

    if (url.pathname === "/webhooks/github") {
      try {
        return await handleGitHubWebhook(request, env);
      } catch (error) {
        console.error("github webhook failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return json({ error: "webhook processing failed" }, 500, { "Cache-Control": "no-store" });
      }
    }

    if (url.pathname === "/webhooks/cloudflare/notifications") {
      try {
        return await handleCloudflareNotificationsWebhook(request, env);
      } catch (error) {
        console.error("cloudflare notifications webhook failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return json({ error: "webhook processing failed" }, 500, { "Cache-Control": "no-store" });
      }
    }

    if (url.pathname === "/webhooks/cloudflare/casb") {
      try {
        return await handleCloudflareCasbWebhook(request, env);
      } catch (error) {
        console.error("cloudflare casb webhook failed", {
          error: error instanceof Error ? error.message : String(error),
        });
        return json({ error: "webhook processing failed" }, 500, { "Cache-Control": "no-store" });
      }
    }

    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json(
        { ok: true, service: "skvallerbyttan", purpose: "github-dashboard" },
        200,
        { "Cache-Control": "no-store" },
      );
    }

    if (url.pathname === "/ready") {
      const ok = configured(env);
      return json({ ok }, ok ? 200 : 503, { "Cache-Control": "no-store" });
    }

    if (url.pathname === "/login") {
      return loginPage(request, authConfigured(env));
    }

    if (url.pathname === "/auth/github") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { Allow: "GET" });
      return startGitHubLogin(env);
    }

    if (url.pathname === "/auth/github/callback") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { Allow: "GET" });
      return handleGitHubCallback(request, env);
    }

    if (url.pathname === "/auth/logout") {
      if (request.method !== "GET") return json({ error: "method not allowed" }, 405, { Allow: "GET" });
      return logout();
    }

    const isApi = url.pathname.startsWith("/api/");
    let apiConsumer: ReadConsumer | null = null;

    if (isApi) {
      if (request.method !== "GET") {
        return json({ error: "method not allowed" }, 405, {
          Allow: "GET",
          "Cache-Control": "no-store",
        });
      }
      const access = await authorizeReadRequest(request, env);
      if (!access.authorized) {
        return json({ error: "authentication required" }, 401, { "Cache-Control": "no-store" });
      }
      if (access.consumer === "chatgpt" && !url.pathname.startsWith("/api/v1/")) {
        return json({ error: "not found" }, 404, { "Cache-Control": "no-store" });
      }
      apiConsumer = access.consumer;
    } else {
      if (!configured(env)) return redirectToLogin();
      const userId = await authenticatedUserId(request, env);
      if (!userId) return redirectToLogin();
    }

    try {
      if (isApi && apiConsumer) {
        const observationResponse = await handleObservationApi(
          request,
          env,
          context,
          apiConsumer,
        );
        if (observationResponse) return observationResponse;

        const startedAt = Date.now();
        const response = await handleApi(request, env, context);
        recordLegacyApiRead(env, url.pathname, apiConsumer, response, startedAt);
        return response;
      }
      const assetResponse = await env.ASSETS.fetch(request);
      const headers = new Headers(assetResponse.headers);
      headers.set("Cache-Control", "private, no-store");
      headers.set("Referrer-Policy", "no-referrer");
      headers.set("X-Content-Type-Options", "nosniff");
      headers.set("X-Frame-Options", "DENY");
      headers.set(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
      );
      return new Response(assetResponse.body, {
        status: assetResponse.status,
        statusText: assetResponse.statusText,
        headers,
      });
    } catch (error) {
      if (error instanceof CloudflareApiError) {
        console.error("cloudflare api request failed", {
          status: error.status,
          error: error.message,
        });
        const status = error.status === 503 ? 503 : 502;
        return json(
          { error: status === 503 ? "cloudflare integration not configured" : "cloudflare upstream request failed" },
          status,
          { "Cache-Control": "no-store" },
        );
      }
      if (error instanceof GitHubApiError && (error.status === 404 || error.status === 403)) {
        return json(
          { error: error.status === 404 ? "repository not found" : "repository access denied" },
          error.status,
          { "Cache-Control": "no-store" },
        );
      }
      console.error("dashboard request failed", {
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return json({ error: "upstream data fetch failed" }, 502, { "Cache-Control": "no-store" });
    }
  },

  async scheduled(_controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(scheduledRefresh(env, context));
  },
};
