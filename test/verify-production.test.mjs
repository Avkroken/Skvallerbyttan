import assert from "node:assert/strict";
import test from "node:test";

import { validateProductionResponse } from "../scripts/verify-production.mjs";

function readyResponse(body, status = 200, contentType = "application/json; charset=utf-8") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": contentType },
  });
}

test("production readiness requires the exact decommissioned payload", async () => {
  await validateProductionResponse(readyResponse({
    ok: true,
    service: "skvallerbyttan",
    check: "decommissioned",
  }));

  await assert.rejects(
    validateProductionResponse(readyResponse({
      ok: false,
      service: "skvallerbyttan",
      check: "decommissioned",
    }, 503)),
    /expected 200/,
  );

  await assert.rejects(
    validateProductionResponse(readyResponse({
      ok: true,
      service: "wrong-service",
      check: "decommissioned",
    })),
    /unexpected readiness payload/,
  );

  await assert.rejects(
    validateProductionResponse(readyResponse({
      ok: true,
      service: "skvallerbyttan",
      check: "configuration",
    })),
    /unexpected readiness payload/,
  );
});

test("production readiness requires JSON", async () => {
  await assert.rejects(
    validateProductionResponse(new Response("ok", {
      status: 200,
      headers: { "content-type": "text/plain" },
    })),
    /unexpected content-type/,
  );
});
