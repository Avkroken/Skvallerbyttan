import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionResponse, validateReadinessResponse, checkProduction } from "../scripts/verify-production.mjs";

const health = () => Response.json({ok: true, service: "skvallerbyttan", purpose: "github-dashboard"});
const ready = () => Response.json({ok: true});

test("accepts healthy service and rejects incorrect payloads", async () => {
  await validateProductionResponse(health());
  await assert.rejects(validateProductionResponse(Response.json({ok: true})));
  await assert.rejects(validateProductionResponse(new Response("failed", {status: 500})));
});

test("accepts ready service and rejects unavailable readiness", async () => {
  await validateReadinessResponse(ready());
  await assert.rejects(validateReadinessResponse(Response.json({ok: false}, {status: 503})));
  await assert.rejects(validateReadinessResponse(new Response(null, {status: 302, headers: {location: "https://example.org"}})));
});

test("checks public health and readiness without following redirects", async () => {
  const calls = [];
  await checkProduction({fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    return url.endsWith("/health") ? health() : ready();
  }});
  assert.deepEqual(calls, ["https://skvallerbyttan.denied.se/health", "https://skvallerbyttan.denied.se/ready"]);
});
