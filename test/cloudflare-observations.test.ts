import assert from "node:assert/strict";
import test from "node:test";
import {
  getCloudflareAccessApplications,
  getCloudflareAccount,
  getCloudflareAuditLogs,
  getCloudflareD1Databases,
  getCloudflareKvNamespaces,
  getCloudflareR2Buckets,
  getCloudflareTunnels,
  getCloudflareWorkers,
  getCloudflareZones,
  normalizeCloudflareAuditLog,
} from "../src/cloudflare";
import type { Env } from "../src/env";

const env = {
  CLOUDFLARE_ACCOUNT_ID: "account123",
  CLOUDFLARE_API_TOKEN: "token",
} as Env;

test("audit log normalization removes raw request and credential metadata", () => {
  const normalized = normalizeCloudflareAuditLog({
    id: "audit-1",
    action: { type: "update", description: "Changed setting", result: "success", time: "2026-09-19T08:00:00Z" },
    actor: {
      id: "actor-1",
      type: "user",
      context: "api_token",
      email: "operator@example.com",
      ip_address: "203.0.113.1",
      token_id: "secret-token-id",
      token_name: "sensitive-token-name",
    },
    raw: { uri: "/accounts/x/workers/scripts/a", method: "PUT", user_agent: "secret-ish" },
    resource: { id: "worker-a", type: "worker", product: "workers", request: { code: "do not expose" } },
  });

  const serialized = JSON.stringify(normalized);
  assert.equal(serialized.includes("secret-token"), false);
  assert.equal(serialized.includes("203.0.113.1"), false);
  assert.equal(serialized.includes("workers/scripts"), false);
  assert.equal(serialized.includes("do not expose"), false);
  assert.equal((normalized as any).resource.id, "worker-a");
});

test("broad Cloudflare reads use only documented GET endpoints and normalized metadata", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    const url = String(input);
    seen.push(url);
    let result: unknown = {};
    if (url.includes("/zones?")) result = [{ id: "z1", name: "example.com", status: "active", plan: { name: "Free" } }];
    else if (url.endsWith("/workers/scripts")) result = [{ id: "worker-a", compatibility_date: "2026-09-01", handlers: ["fetch"] }];
    else if (url.includes("/logs/audit?")) result = [{ id: "a1", action: { type: "update", time: "2026-09-19T08:00:00Z" } }];
    else if (url.includes("/d1/database")) result = [{ uuid: "d1-1", name: "stats", created_at: "2026-09-01T00:00:00Z", secret_value: "must-not-leak" }];
    else if (url.includes("/storage/kv/namespaces")) result = [{ id: "kv-1", title: "cache", hidden_value: "must-not-leak" }];
    else if (url.includes("/r2/buckets")) result = { buckets: [{ name: "artifacts", creation_date: "2026-09-01T00:00:00Z", object: "must-not-leak" }] };
    else if (url.includes("/access/apps")) result = [{ id: "app-1", name: "Dashboard", type: "self_hosted", domain: "private.example", policies: [{ id: "p1", name: "Allow", decision: "allow" }], secret: "must-not-leak" }];
    else if (url.includes("/tunnels?")) result = [{ id: "tun-1", name: "edge", status: "healthy", tun_type: "cfd_tunnel", config_src: "cloudflare", connections: [{ origin_ip: "203.0.113.1" }] }];
    else if (url.endsWith("/accounts/account123")) result = { id: "account123", name: "Avkroken" };
    return new Response(JSON.stringify({ success: true, result }), {
      headers: { "content-type": "application/json", Ratelimit: '"default";r=1199;t=300' },
    });
  };

  try {
    assert.equal((await getCloudflareAccount(env) as any).name, "Avkroken");
    assert.equal((await getCloudflareZones(env) as any).count, 1);
    assert.equal((await getCloudflareWorkers(env) as any).count, 1);
    const d1 = await getCloudflareD1Databases(env) as any;
    const kv = await getCloudflareKvNamespaces(env) as any;
    const r2 = await getCloudflareR2Buckets(env) as any;
    const access = await getCloudflareAccessApplications(env) as any;
    const tunnels = await getCloudflareTunnels(env) as any;
    assert.equal(d1.count, 1);
    assert.equal(kv.count, 1);
    assert.equal(r2.count, 1);
    assert.equal(access.count, 1);
    assert.equal(tunnels.count, 1);
    assert.equal((await getCloudflareAuditLogs(env, 1) as any).count, 1);
    const serialized = JSON.stringify({ d1, kv, r2, access, tunnels });
    assert.equal(serialized.includes("must-not-leak"), false);
    assert.equal(serialized.includes("203.0.113.1"), false);
    assert.equal(seen.some((url) => url.includes("/values/")), false);
    assert.equal(seen.some((url) => url.includes("/d1/database/") && url.includes("/query")), false);
    assert.equal(seen.every((url) => url.startsWith("https://api.cloudflare.com/client/v4/")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test("Cloudflare inventories follow page and cursor pagination without reading contents", async () => {
  const originalFetch = globalThis.fetch;
  const seen: string[] = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    seen.push(url.toString());

    if (url.pathname.endsWith("/d1/database")) {
      const page = Number(url.searchParams.get("page") || "1");
      return new Response(JSON.stringify({
        success: true,
        result: [{ uuid: `d1-${page}`, name: `db-${page}` }],
        result_info: { count: 1, page, per_page: 1, total_count: 2 },
      }));
    }

    if (url.pathname.endsWith("/r2/buckets")) {
      const cursor = url.searchParams.get("cursor");
      return new Response(JSON.stringify({
        success: true,
        result: { buckets: [{ name: cursor ? "bucket-2" : "bucket-1" }] },
        result_info: { cursor: cursor ? null : "next-page", per_page: 1 },
      }));
    }

    throw new Error(`unexpected URL: ${url}`);
  };

  try {
    const d1 = await getCloudflareD1Databases(env) as any;
    const r2 = await getCloudflareR2Buckets(env) as any;
    assert.equal(d1.count, 2);
    assert.equal(d1.truncated, false);
    assert.equal(r2.count, 2);
    assert.equal(r2.truncated, false);
    assert.equal(seen.filter((url) => url.includes("/d1/database")).length, 2);
    assert.equal(seen.filter((url) => url.includes("/r2/buckets")).length, 2);
    assert.equal(seen.some((url) => url.includes("/query")), false);
    assert.equal(seen.some((url) => url.includes("/objects")), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
