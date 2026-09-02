import type { Env } from "./env";
import { getOverview, getRepositoryDetail } from "./data";
import { GitHubApiError } from "./github";
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
  authConfigured,
  authenticatedUserId,
  handleGitHubCallback,
  loginPage,
  logout,
  startGitHubLogin,
} from "./auth";

const CACHE_SECONDS = 300;
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

function cacheKey(request: Request): Request {
  const url = new URL(request.url);
  return new Request(`${url.origin}${url.pathname}`, { method: "GET" });
}

async function cachedJson(
  request: Request,
  context: ExecutionContext,
  loader: () => Promise<unknown>,
): Promise<Response> {
  const bypass = new URL(request.url).searchParams.get("refresh") === "1";
  const key = cacheKey(request);
  if (!bypass) {
    const cached = await caches.default.match(key);
    if (cached) {
      const headers = new Headers(cached.headers);
      headers.set("Cache-Control", "private, max-age=0");
      headers.set("X-Skvallerbyttan-Cache", "hit");
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers,
      });
    }
  }

  const value = await loader();
  const response = json(value, 200, {
    "Cache-Control": "private, max-age=0",
    "X-Skvallerbyttan-Cache": "miss",
    "X-Skvallerbyttan-Cache-Ttl": String(CACHE_SECONDS),
  });
  const cacheable = response.clone();
  cacheable.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  context.waitUntil(caches.default.put(key, cacheable));
  return response;
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

async function handleApi(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/overview") {
    return cachedJson(request, context, () => overviewWithHistory(env, context));
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
    return cachedJson(request, context, () => getRepositoryInsights(env, repo));
  }

  const match = url.pathname.match(/^\/api\/repos\/([^/]+)$/);
  if (match) {
    const repo = validRepoSegment(match[1]);
    if (!repo) return json({ error: "invalid repository name" }, 400);
    return cachedJson(request, context, () => getRepositoryDetail(env, repo));
  }

  return json({ error: "not found" }, 404);
}

export default {
  async fetch(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/healthz") {
      return json({ ok: true, service: "skvallerbyttan", purpose: "github-dashboard" });
    }

    if (url.pathname === "/ready") {
      return json(
        {
          ok: configured(env),
          service: "skvallerbyttan",
          purpose: "github-dashboard",
          check: "configuration",
          statisticsHistory: historyConfigured(env),
        },
        configured(env) ? 200 : 503,
      );
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
          {
            error: "dashboard is not fully configured",
            required: [
              "SKVALLERBYTTAN_GAMNACKE_CLIENT_ID",
              "SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY",
              "SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID",
              "SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET",
              "SKVALLERBYTTAN_SESSION_SECRET",
              "SKVALLERBYTTAN_ALLOWED_GITHUB_IDS",
            ],
          },
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
};
