import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import {
  authenticatedUserId,
  handleGitHubCallback,
  startGitHubLogin,
} from "../src/auth";

function env(allowed = "36226327"): Env {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    SKVALLERBYTTAN_GAMNACKE_CLIENT_ID: "gamnacke-client",
    SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY: "private-key",
    SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID: "krosa-client",
    SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET: "krosa-secret",
    SKVALLERBYTTAN_SESSION_SECRET: "session-secret-with-enough-entropy-for-tests",
    SKVALLERBYTTAN_ALLOWED_GITHUB_IDS: allowed,
    SKVALLERBYTTAN_ORG: "Avkroken",
  };
}

function cookiePair(setCookie: string, name: string): string {
  const match = setCookie.match(new RegExp(`${name}=([^;,\\s]+)`));
  if (!match) throw new Error(`cookie ${name} missing`);
  return `${name}=${match[1]}`;
}

test("OAuth flow uses state and PKCE and creates an allowlisted signed session", async () => {
  const testEnv = env();
  const start = await startGitHubLogin(testEnv);
  assert.equal(start.status, 303);
  const authorize = new URL(start.headers.get("location") ?? "");
  assert.equal(authorize.origin, "https://github.com");
  assert.equal(authorize.pathname, "/login/oauth/authorize");
  assert.equal(authorize.searchParams.get("client_id"), "krosa-client");
  assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
  assert.ok(authorize.searchParams.get("code_challenge"));
  const state = authorize.searchParams.get("state");
  assert.ok(state);

  const oauthCookie = cookiePair(
    start.headers.get("set-cookie") ?? "",
    "__Host-skvallerbyttan_oauth",
  );

  const originalFetch = globalThis.fetch;
  const globalWithFetch = globalThis as unknown as { fetch: typeof fetch };
  globalWithFetch.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://github.com/login/oauth/access_token") {
      assert.equal(init?.method, "POST");
      const body = String(init?.body ?? "");
      assert.ok(body.includes("code_verifier="));
      return new Response(JSON.stringify({ access_token: "gho_test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://api.github.com/user") {
      assert.equal(new Headers(init?.headers).get("authorization"), "Bearer gho_test");
      return new Response(JSON.stringify({ id: 36226327, login: "blixten85" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url.includes("/applications/krosa-client/token")) {
      assert.equal(init?.method, "DELETE");
      return new Response(null, { status: 204 });
    }
    throw new Error(`unexpected fetch ${url}`);
  };

  try {
    const callback = await handleGitHubCallback(
      new Request(`https://skvallerbyttan.denied.se/auth/github/callback?code=abc&state=${encodeURIComponent(state ?? "")}`, {
        headers: { Cookie: oauthCookie },
      }),
      testEnv,
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), "/");

    const sessionCookie = cookiePair(
      callback.headers.get("set-cookie") ?? "",
      "__Host-skvallerbyttan_session",
    );
    const userId = await authenticatedUserId(
      new Request("https://skvallerbyttan.denied.se/", { headers: { Cookie: sessionCookie } }),
      testEnv,
    );
    assert.equal(userId, 36226327);
  } finally {
    globalWithFetch.fetch = originalFetch;
  }
});

test("OAuth callback rejects a mismatched state before any GitHub request", async () => {
  const testEnv = env();
  const start = await startGitHubLogin(testEnv);
  const oauthCookie = cookiePair(
    start.headers.get("set-cookie") ?? "",
    "__Host-skvallerbyttan_oauth",
  );

  const originalFetch = globalThis.fetch;
  const globalWithFetch = globalThis as unknown as { fetch: typeof fetch };
  let calls = 0;
  globalWithFetch.fetch = async (): Promise<Response> => {
    calls += 1;
    return new Response(null, { status: 500 });
  };

  try {
    const callback = await handleGitHubCallback(
      new Request("https://skvallerbyttan.denied.se/auth/github/callback?code=abc&state=wrong", {
        headers: { Cookie: oauthCookie },
      }),
      testEnv,
    );
    assert.equal(callback.status, 303);
    assert.equal(callback.headers.get("location"), "/login?error=state");
    assert.equal(calls, 0);
  } finally {
    globalWithFetch.fetch = originalFetch;
  }
});

test("signed sessions are rechecked against the current allowlist", async () => {
  const allowedEnv = env();
  const start = await startGitHubLogin(allowedEnv);
  const authorize = new URL(start.headers.get("location") ?? "");
  const state = authorize.searchParams.get("state") ?? "";
  const oauthCookie = cookiePair(
    start.headers.get("set-cookie") ?? "",
    "__Host-skvallerbyttan_oauth",
  );

  const originalFetch = globalThis.fetch;
  const globalWithFetch = globalThis as unknown as { fetch: typeof fetch };
  globalWithFetch.fetch = async (input: RequestInfo | URL): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (url === "https://github.com/login/oauth/access_token") {
      return new Response(JSON.stringify({ access_token: "gho_test" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (url === "https://api.github.com/user") {
      return new Response(JSON.stringify({ id: 36226327 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(null, { status: 204 });
  };

  try {
    const callback = await handleGitHubCallback(
      new Request(`https://skvallerbyttan.denied.se/auth/github/callback?code=abc&state=${encodeURIComponent(state)}`, {
        headers: { Cookie: oauthCookie },
      }),
      allowedEnv,
    );
    const sessionCookie = cookiePair(
      callback.headers.get("set-cookie") ?? "",
      "__Host-skvallerbyttan_session",
    );
    const deniedEnv = env("999999999");
    const userId = await authenticatedUserId(
      new Request("https://skvallerbyttan.denied.se/", { headers: { Cookie: sessionCookie } }),
      deniedEnv,
    );
    assert.equal(userId, null);
  } finally {
    globalWithFetch.fetch = originalFetch;
  }
});
