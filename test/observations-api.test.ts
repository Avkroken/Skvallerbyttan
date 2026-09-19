import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import { handleObservationApi } from "../src/observations-api";

function context(): ExecutionContext {
  return {
    waitUntil() {},
    passThroughOnException() {},
  } as unknown as ExecutionContext;
}

test("canonical API never exposes provider error bodies or stack-like details", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    success: false,
    errors: [{
      code: 1000,
      message: "STACK TRACE /srv/private.ts:42 secret-internal-detail",
    }],
  }), {
    status: 500,
    headers: { "content-type": "application/json" },
  });

  try {
    const response = await handleObservationApi(
      new Request("https://skvallerbyttan.denied.se/api/v1/cloudflare/account"),
      {
        CLOUDFLARE_ACCOUNT_ID: "account123",
        CLOUDFLARE_API_TOKEN_R2: "token",
      } as Env,
      context(),
      "chatgpt",
    );

    assert.ok(response);
    const body = await response!.text();
    assert.equal(response!.status, 200);
    assert.equal(body.includes("STACK TRACE"), false);
    assert.equal(body.includes("secret-internal-detail"), false);
    assert.equal(body.includes("cloudflare_provider_request_failed"), true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
