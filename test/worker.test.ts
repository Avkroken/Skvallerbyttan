import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import worker from "../src/worker";

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

test("legacy webhook endpoint is gone instead of redirecting to login", async () => {
  const response = await worker.fetch(
    new Request("https://skvallerbyttan.denied.se/webhook", { method: "POST" }),
    {} as Env,
    context(),
  );

  assert.equal(response.status, 410);
  assert.equal(response.headers.get("location"), null);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), {
    error: "legacy webhook endpoint removed",
    endpoint: "/webhooks/github",
  });
});


test("Cloudflare webhook endpoints stay outside dashboard login but fail closed when unconfigured", async () => {
  for (const path of ["/webhooks/cloudflare/notifications", "/webhooks/cloudflare/casb"]) {
    const response = await worker.fetch(
      new Request(`https://skvallerbyttan.denied.se${path}`, { method: "POST" }),
      {} as Env,
      context(),
    );
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("location"), null);
    assert.deepEqual(await response.json(), { error: "webhook not configured" });
  }
});
