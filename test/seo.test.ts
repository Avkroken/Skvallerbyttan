import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import entry from "../src/entry";

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

function configuredEnv(): Env {
  return {
    ASSETS: { fetch: async () => new Response("asset") },
    SKVALLERBYTTAN_GAMNACKE_CLIENT_ID: "test-gamnacke",
    SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY: "test-private-key",
    SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID: "test-krosa-maja",
    SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET: "test-client-secret",
    SKVALLERBYTTAN_SESSION_SECRET: "test-session-secret",
    SKVALLERBYTTAN_ALLOWED_GITHUB_IDS: "1",
  };
}

test("robots.txt is public and allows crawling so noindex can be observed", async () => {
  const response = await entry.fetch(
    new Request("https://skvallerbyttan.denied.se/robots.txt"),
    {} as Env,
    context(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
  const body = await response.text();
  assert.ok(/User-agent: \*/.test(body));
  assert.ok(/Allow: \/$/m.test(body));
  assert.ok(!/Disallow: \/$/m.test(body));
});

test("sitemap.xml is absent instead of redirecting to login", async () => {
  const response = await entry.fetch(
    new Request("https://skvallerbyttan.denied.se/sitemap.xml"),
    {} as Env,
    context(),
  );

  assert.equal(response.status, 404);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("x-robots-tag"), "noindex");
});

test("public login response is explicitly noindex", async () => {
  const response = await entry.fetch(
    new Request("https://skvallerbyttan.denied.se/login"),
    configuredEnv(),
    context(),
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});

test("anonymous app redirect is also explicitly noindex", async () => {
  const response = await entry.fetch(
    new Request("https://skvallerbyttan.denied.se/"),
    {} as Env,
    context(),
  );

  assert.equal(response.status, 303);
  assert.equal(response.headers.get("location"), "/login");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow, noarchive");
});
