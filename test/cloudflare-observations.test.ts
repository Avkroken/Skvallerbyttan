import assert from "node:assert/strict";
import test from "node:test";
import {
  getCloudflareAccount,
  getCloudflareAuditLogs,
  getCloudflareWorkers,
  getCloudflareZones,
  normalizeCloudflareAuditLog,
} from "../src/cloudflare";
import type { Env } from "../src/env";

const env = {
  SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID: "account123",
  SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN: "token",
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
    else if (url.endsWith("/accounts/account123")) result = { id: "account123", name: "Avkroken" };
    return new Response(JSON.stringify({ success: true, result }), {
      headers: { "content-type": "application/json", Ratelimit: '"default";r=1199;t=300' },
    });
  };

  try {
    assert.equal((await getCloudflareAccount(env) as any).name, "Avkroken");
    assert.equal((await getCloudflareZones(env) as any).count, 1);
    assert.equal((await getCloudflareWorkers(env) as any).count, 1);
    assert.equal((await getCloudflareAuditLogs(env, 1) as any).count, 1);
    assert.equal(seen.every((url) => url.startsWith("https://api.cloudflare.com/client/v4/")), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
