import type { Env } from "./env";
import { getOverview, getRepositoryDetail } from "./data";
import { GitHubApiError, mapLimit } from "./github";
import { getRepositoryInsights } from "./insights";
import {
  captureOverviewSnapshot,
  getHistory,
  historyConfigured,
  previousOverviewSnapshot,
  sinceLast,
  snapshotFromOverview,
} from "./history";
import {
  readSourceCache,
  sourceCacheAgeMs,
  sourceCacheConfigured,
  type SourceCacheKind,
  writeSourceCache,
} from "./source-cache";
import {
  authConfigured,
  authenticatedUserId,
  handleGitHubCallback,
  loginPage,
  logout,
  startGitHubLogin,
} from "./auth";

const OVERVIEW_CACHE_MS = 15 * 60 * 1000;
const DEEP_CACHE_MS = 60 * 60 * 1000;
const ACTIVE_DAY_START_HOUR = 6;
const ACTIVE_DAY_END_HOUR = 23;
const REPO_NAME = /^[A-Za-z0-9_.-]+$/;

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

function cacheHeaders(state: "hit" | "stale" | "miss", refreshedAt: string, ageMs: number, ttlMs: number): HeadersInit {
  return {
    "Cache-Control": "private, no-store",
    "X-Skvallerbyttan-Cache": state,
    "X-Skvallerbyttan-Cache-Age": String(Math.floor(ageMs / 1000)),
    "X-Skvallerbyttan-Cache-Refreshed-At": refreshedAt,
    "X-Skvallerbyttan-Cache-Ttl": String(Math.floor(ttlMs / 1000)),
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
      const stale = ageMs > ttlMs;
      if (stale) {
        context.waitUntil(refreshSourceValue(env, key, kind, loader).catch((error) => {
          console.error("source cache background refresh failed", {
            key,
            error: error instanceof Error ? error.message : String(error),
          });
        }));
      }
      return json(
        cached.value,
        200,
        cacheHeaders(stale ? "stale" : "hit", cached.refreshedAt, ageMs, ttlMs),
      );
    }
  } catch (error) {
    console.error("source cache read failed", {
      key,
      error: error instanceof Error ? error.message : String(error),
    });
  }

  const value = await refreshSourceValue(env, key, kind, loader);
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
  return await refreshSourceValue(
    env,
    "overview",
    "overview",
    () => overviewWithHistory(env, context),
  ) as Record<string, unknown>;
}

function overviewRepoNames(overview: Record<string, unknown>): string[] {
  const repositories = Array.isArray(overview.repositories) ? overview.repositories : [];
  return repositories
    .map((repo) => repo && typeof repo === "object" && "name" in repo ? (repo as { name?: unknown }).name : null)
    .filter((name): name is string => typeof name === "string" && REPO_NAME.test(name));
}

async function refreshDeepCache(env: Env, repoNames: string[]): Promise<void> {
  await mapLimit(repoNames, 2, async (repo) => {
    try {
      await refreshSourceValue(env, `repository:${repo}`, "repository", () => getRepositoryDetail(env, repo));
    } catch (error) {
      console.error("scheduled repository refresh failed", {
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    try {
      await refreshSourceValue(env, `insights:${repo}`, "insights", () => getRepositoryInsights(env, repo));
    } catch (error) {
      console.error("scheduled insights refresh failed", {
        repo,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

function stockholmHour(date: Date): number {
  const value = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Stockholm",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(date);
  return Number(value);
}

async function scheduledRefresh(controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
  if (!sourceCacheConfigured(env)) {
    console.error("scheduled source refresh skipped: STATS_DB is not bound");
    return;
  }

  const scheduledAt = new Date(controller.scheduledTime);
  const minute = scheduledAt.getUTCMinutes();
  const hour = stockholmHour(scheduledAt);
  const activeDay = hour >= ACTIVE_DAY_START_HOUR && hour < ACTIVE_DAY_END_HOUR;

  // During an active day the operational overview is refreshed every 15 minutes.
  // Overnight it is refreshed hourly together with the deep cache.
  if (!activeDay && minute !== 0) return;

  let overview: Record<string, unknown>;
  try {
    overview = await refreshOverviewCache(env, context);
  } catch (error) {
    console.error("scheduled overview refresh failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (minute === 0) {
    await refreshDeepCache(env, overviewRepoNames(overview));
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
      OVERVIEW_CACHE_MS,
      () => overviewWithHistory(env, context),
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
      DEEP_CACHE_MS,
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
      DEEP_CACHE_MS,
      () => getRepositoryDetail(env, repo),
    );
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

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

    if (!configured(env)) {
      if (url.pathname.startsWith("/api/")) {
        return json(
          { error: "service unavailable" },
          503,
          { "Cache-Control": "no-store" },
        );
      }
      return redirectToLogin();
    }

    const userId = await authenticatedUserId(request, env);
    if (!userId) {
      if (url.pathname.startsWith("/api/")) {
        return json({ error: "authentication required" }, 401, { "Cache-Control": "no-store" });
      }
      return redirectToLogin();
    }

    try {
      if (url.pathname.startsWith("/api/")) {
        return await handleApi(request, env, context);
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

  async scheduled(controller: ScheduledController, env: Env, context: ExecutionContext): Promise<void> {
    context.waitUntil(scheduledRefresh(controller, env, context));
  },
};
