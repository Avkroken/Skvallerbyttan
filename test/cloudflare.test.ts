import assert from "node:assert/strict";
import test from "node:test";
import {
  cloudflareApiConfigured,
  getCloudflareCasbWebhooks,
  getCloudflareNotificationWebhooks,
  getCloudflareTunnels,
  getCloudflareZones,
} from "../src/cloudflare";
import type { Env } from "../src/env";

const classedEnv = {
  CLOUDFLARE_ACCOUNT_ID: "account123",
  CLOUDFLARE_API_TOKEN_R1: "token-r1",
  CLOUDFLARE_API_TOKEN_R2: "token-r2",
  CLOUDFLARE_API_TOKEN_R3: "token-r3",
} as Env;

const secretsStoreEnv = {
  CLOUDFLARE_ACCOUNT_ID: "account123",
  CLOUDFLARE_API_TOKEN_R1: { get: async () => "store-token-r1" },
  CLOUDFLARE_API_TOKEN_R2: { get: async () => "store-token-r2" },
  CLOUDFLARE_API_TOKEN_R3: { get: async () => "store-token-r3" },
} as Env;

test("Cloudflare API configuration requires account id and a class credential", () => {
  assert.equal(cloudflareApiConfigured(classedEnv), true);
  assert.equal(cloudflareApiConfigured({ CLOUDFLARE_ACCOUNT_ID: "account123" } as Env), false);
});

test("R1 is used for platform resource reads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input).startsWith("https://api.cloudflare.com/client/v4/zones?"), true);
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer store-token-r1");
    return new Response(JSON.stringify({
      success: true,
      result: [],
      result_info: { count: 0, page: 1, per_page: 50, total_count: 0, total_pages: 0 },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const result = await getCloudflareZones(secretsStoreEnv);
    assert.equal(result.available, true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("R3 tunnel inventory uses the cloudflared endpoint", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://api.cloudflare.com/client/v4/accounts/account123/cfd_tunnel?per_page=100&is_deleted=false&page=1",
    );
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer store-token-r3");
    return new Response(JSON.stringify({
      success: true,
      result: [{
        id: "tunnel-id",
        name: "avkroken",
        status: "healthy",
        config_src: "cloudflare",
        tun_type: "cfd_tunnel",
        created_at: "2026-09-19T00:00:00Z",
        deleted_at: null,
      }],
      result_info: { count: 1, page: 1, per_page: 100, total_count: 1, total_pages: 1 },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const result = await getCloudflareTunnels(secretsStoreEnv);
    assert.equal(result.available, true);
    assert.equal(result.count, 1);
    assert.deepEqual((result.items as Array<Record<string, unknown>>)[0], {
      id: "tunnel-id",
      name: "avkroken",
      status: "healthy",
      remoteConfig: null,
      configSource: "cloudflare",
      type: "cfd_tunnel",
      createdAt: "2026-09-19T00:00:00Z",
      deletedAt: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("R2 is used for account reads", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.cloudflare.com/client/v4/accounts/account123");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token-r2");
    return new Response(JSON.stringify({
      success: true,
      result: { id: "account123", name: "Avkroken" },
    }), { headers: { "content-type": "application/json" } });
  };

  try {
    const { getCloudflareAccount } = await import("../src/cloudflare");
    assert.equal((await getCloudflareAccount(classedEnv) as any).name, "Avkroken");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("notification webhook reads redact destination URLs", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(String(input), "https://api.cloudflare.com/client/v4/accounts/account123/alerting/v3/destinations/webhooks");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token-r2");
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
    const result = await getCloudflareNotificationWebhooks(classedEnv);
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
  globalThis.fetch = async (_input, init) => {
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer token-r3");
    return new Response(JSON.stringify({
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
  };

  try {
    const result = await getCloudflareCasbWebhooks(classedEnv);
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
