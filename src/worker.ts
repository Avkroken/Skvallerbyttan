import type { Env } from "./env";
import { getOverview, getRepositoryDetail } from "./data";

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
    env.SKVALLERBYTTAN_CLIENT_ID &&
    env.SKVALLERBYTTAN_APP_PRIVATE_KEY &&
    env.SKVALLERBYTTAN_DASHBOARD_PASSWORD,
  );
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function authorized(request: Request, env: Env): boolean {
  const password = env.SKVALLERBYTTAN_DASHBOARD_PASSWORD;
  if (!password) return false;
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Basic ")) return false;

  try {
    const decoded = atob(auth.slice(6));
    const separator = decoded.indexOf(":");
    if (separator < 0) return false;
    const username = decoded.slice(0, separator);
    const suppliedPassword = decoded.slice(separator + 1);
    const expectedUsername = env.SKVALLERBYTTAN_DASHBOARD_USERNAME?.trim() || "avkroken";
    return safeEqual(username, expectedUsername) && safeEqual(suppliedPassword, password);
  } catch {
    return false;
  }
}

function authRequired(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Skvallerbyttan", charset="UTF-8"',
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function cacheKey(request: Request): Request {
  const url = new URL(request.url);
  return new Request(`https://skvallerbyttan-cache.internal${url.pathname}`, { method: "GET" });
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
    if (cached) return cached;
  }

  const value = await loader();
  const response = json(value, 200, {
    "Cache-Control": `private, max-age=0`,
    "X-Skvallerbyttan-Cache-Ttl": String(CACHE_SECONDS),
  });
  const cacheable = response.clone();
  cacheable.headers.set("Cache-Control", `public, max-age=${CACHE_SECONDS}`);
  context.waitUntil(caches.default.put(key, cacheable));
  return response;
}

async function handleApi(request: Request, env: Env, context: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname === "/api/overview") {
    return cachedJson(request, context, () => getOverview(env));
  }

  const match = url.pathname.match(/^\/api\/repos\/([^/]+)$/);
  if (match) {
    const repo = decodeURIComponent(match[1]);
    if (!REPO_NAME.test(repo)) return json({ error: "invalid repository name" }, 400);
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
        },
        configured(env) ? 200 : 503,
      );
    }

    if (!configured(env)) {
      return json(
        {
          error: "dashboard is not fully configured",
          required: [
            "SKVALLERBYTTAN_CLIENT_ID",
            "SKVALLERBYTTAN_APP_PRIVATE_KEY",
            "SKVALLERBYTTAN_DASHBOARD_PASSWORD",
          ],
        },
        503,
        { "Cache-Control": "no-store" },
      );
    }

    if (!authorized(request, env)) return authRequired();

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
      console.error("dashboard request failed", {
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      });
      return json({ error: "upstream data fetch failed" }, 502, { "Cache-Control": "no-store" });
    }
  },
};
