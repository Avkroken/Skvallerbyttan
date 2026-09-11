import test from "node:test";
import assert from "node:assert/strict";
import { validateProductionResponse, validateAccessResponse, checkProduction } from "../scripts/verify-production.mjs";
const health = () => Response.json({ok: true, service: "skvallerbyttan", purpose: "github-dashboard"});
const login = "https://mp100.cloudflareaccess.com/cdn-cgi/access/login/skvallerbyttan.denied.se";
const redirect = (location = login) => new Response(null, {status: 302, headers: {location}});
test("accepts healthy service and rejects incorrect payloads", async () => {
  await validateProductionResponse(health());
  await assert.rejects(validateProductionResponse(Response.json({ok: true})));
  await assert.rejects(validateProductionResponse(new Response("failed", {status: 500})));
});
test("requires exact Access host and application, rejects exposed endpoint", () => {
  validateAccessResponse(redirect());
  for (const response of [health(), redirect("https://example.org"), redirect(login.replace("skvallerbyttan.denied.se", "other.denied.se")), redirect(login.replace("https:", "http:"))]) {
    assert.throws(() => validateAccessResponse(response));
  }
});
test("checks public health and protected readiness without following redirects", async () => {
  const calls = [];
  await checkProduction({fetchImpl: async (url, options) => {
    calls.push(url);
    assert.equal(options.redirect, "manual");
    return url.endsWith("/healthz") ? health() : redirect();
  }});
  assert.deepEqual(calls, ["https://skvallerbyttan.denied.se/healthz", "https://skvallerbyttan.denied.se/ready"]);
});
