import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareApiConfigured,
  getCloudflareCasbWebhooks,
  getCloudflareNotificationWebhooks,
} from "../src/cloudflare";
import type { Env } from "../src/env";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account123",
  CLOUDFLARE_API_TOKEN: "token",
} as Env;

test("Cloudflare API configuration requires both account id and token", () => {
  assert.equal(cloudflareApiConfigured(env), true);
  assert.equal(cloudflareApiConfigured({ CLOUDFLARE_ACCOUNT_ID: "account123" } as Env), false);
});

test("legacy Skvallerbyttan Cloudflare names remain a migration fallback", () => {
  assert.equal(cloudflareApiConfigured({
    SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID: "legacy-account",
    SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN: "legacy-token",
  } as Env), true);
});

test("canonical Cloudflare names take precedence over migration aliases", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.cloudflare.com/client/v4/accounts/canonical-account");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer canonical-token");
    return new Response(JSON.stringify({
      success: true,
      result: { id: "canonical-account", name: "Avkroken" },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const configured = {
      CLOUDFLARE_ACCOUNT_ID: "canonical-account",
      CLOUDFLARE_API_TOKEN: "canonical-token",
      SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID: "legacy-account",
      SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN: "legacy-token",
    } as Env;
    const { getCloudflareAccount } = await import("../src/cloudflare");
    assert.equal((await getCloudflareAccount(configured) as any).name, "Avkroken");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notification webhook reads redact destination URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.cloudflare.com/client/v4/accounts/account123/alerting/v3/destinations/webhooks");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token");
    return new Response(JSON.stringify({
      success: true,
      result: [{
        id: "hook",
        name: "Skvallerbyttan",
        type: "generic",
        url: "https://example.invalid/secret-path",
        secret: "never-returned-but-do-not-copy",
        created_at: "2026-09-19T00:00:00Z",
        last_success: "2026-09-19T01:00:00Z",
      }],
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const result = await getCloudflareNotificationWebhooks(env);
    assert.deepEqual(result, {
      available: true,
      count: 1,
      items: [{
        id: "hook",
        name: "Skvallerbyttan",
        type: "generic",
        createdAt: "2026-09-19T00:00:00Z",
        lastSuccess: "2026-09-19T01:00:00Z",
        lastFailure: null,
      }],
    });
    assert.equal(JSON.stringify(result).includes("secret-path"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("CASB webhook reads expose header names but redact destination and values", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: true,
    result: [{
      id: "casb-hook",
      label: "Skvallerbyttan CASB",
      authentication_type: "Static Headers",
      destination_url: "https://example.invalid/private",
      status: "enabled",
      version: 2,
      created_at: "2026-09-18T00:00:00Z",
      updated_at: "2026-09-19T00:00:00Z",
      headers: [{ key: "x-skvallerbyttan-casb-auth", value: "redacted-by-cloudflare" }],
    }],
  }), { headers: { "content-type": "application/json" } });

  try {
    const result = await getCloudflareCasbWebhooks(env);
    assert.deepEqual(result, {
      available: true,
      count: 1,
      items: [{
        id: "casb-hook",
        label: "Skvallerbyttan CASB",
        authenticationType: "Static Headers",
        status: "enabled",
        version: 2,
        createdAt: "2026-09-18T00:00:00Z",
        updatedAt: "2026-09-19T00:00:00Z",
        headerKeys: ["x-skvallerbyttan-casb-auth"],
      }],
    });
    const serialized = JSON.stringify(result);
    assert.equal(serialized.includes("example.invalid"), false);
    assert.equal(serialized.includes("redacted-by-cloudflare"), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
