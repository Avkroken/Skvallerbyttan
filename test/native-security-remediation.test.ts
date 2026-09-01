import assert from "node:assert/strict";
import test from "node:test";
import {
  COPILOT_SECURITY_AGENT,
  dependabotHasPatch,
  tryNativeCodeScanningRemediation,
  tryNativeDependabotRemediation,
} from "../src/native-security-remediation.ts";

function response(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("detects an available Dependabot patch", () => {
  assert.equal(dependabotHasPatch({ security_vulnerability: { first_patched_version: { identifier: "2.0.1" } } }), true);
  assert.equal(dependabotHasPatch({ security_vulnerability: { first_patched_version: null } }), false);
});

test("prefers enabled Dependabot security updates for patchable non-malware alerts", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const request = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET" });
    return response({ enabled: true, paused: false });
  };

  const result = await tryNativeDependabotRemediation(
    request,
    "Avkroken/example",
    { number: 7, security_vulnerability: { first_patched_version: { identifier: "2.0.1" } } },
    false,
  );

  assert.deepEqual(result, { handled: true, reason: "dependabot-security-updates" });
  assert.deepEqual(calls, [{ path: "/repos/Avkroken/example/automated-security-fixes", method: "GET" }]);
});

test("requires Dependabot security updates to be explicitly active", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const request = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET" });
    if (path.endsWith("/automated-security-fixes")) return response({ enabled: true });
    if (!init?.method) return response({ assignees: [] });
    return response({});
  };

  const result = await tryNativeDependabotRemediation(
    request,
    "Avkroken/example",
    { number: 8, security_vulnerability: { first_patched_version: { identifier: "2.0.1" } } },
    false,
  );

  assert.deepEqual(result, { handled: true, reason: "copilot-agent" });
  assert.equal(calls[0]?.path, "/repos/Avkroken/example/automated-security-fixes");
  assert.equal(calls.at(-1)?.method, "PATCH");
});

test("assigns Copilot for code scanning while preserving existing assignees", async () => {
  const writes: unknown[] = [];
  const request = async (_path: string, init?: RequestInit) => {
    if (!init?.method) return response({ assignees: [{ login: "octocat" }] });
    writes.push(JSON.parse(String(init.body)));
    return response({});
  };

  const result = await tryNativeCodeScanningRemediation(request, "Avkroken/example", { number: 42 });

  assert.deepEqual(result, { handled: true, reason: "copilot-agent" });
  assert.deepEqual(writes, [{ assignees: ["octocat", COPILOT_SECURITY_AGENT] }]);
});

test("falls back when Copilot assignment cannot be written", async () => {
  const request = async (_path: string, init?: RequestInit) => {
    if (!init?.method) return response({ assignees: [] });
    throw new Error("forbidden");
  };

  const result = await tryNativeCodeScanningRemediation(request, "Avkroken/example", { number: 42 });
  assert.deepEqual(result, { handled: false, reason: "fallback" });
});

test("uses Copilot for malware instead of Dependabot security updates", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const request = async (path: string, init?: RequestInit) => {
    calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined });
    if (!init?.method) return response({ assignees: [] });
    return response({});
  };

  const result = await tryNativeDependabotRemediation(
    request,
    "Avkroken/example",
    { number: 9, security_vulnerability: { first_patched_version: { identifier: "3.0.0" } } },
    true,
  );

  assert.deepEqual(result, { handled: true, reason: "copilot-agent" });
  assert.equal(calls.some((call) => call.path.endsWith("/automated-security-fixes")), false);
  assert.equal(calls.at(-1)?.method, "PATCH");
});
