import assert from "node:assert/strict";
import test from "node:test";

import {
  deployProduction,
  validateReadinessResponse,
  workersBuildMetadata,
} from "./deploy-production.mjs";

const SHA = "0123456789abcdef0123456789abcdef01234567";

test("Workers Builds production metadata requires main and a full commit SHA", () => {
  assert.deepEqual(workersBuildMetadata({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main", WORKERS_CI_COMMIT_SHA: SHA }), {
    commitSha: SHA,
  });
  assert.throws(
    () => workersBuildMetadata({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "feature", WORKERS_CI_COMMIT_SHA: SHA }),
    /expected main/,
  );
  assert.throws(
    () => workersBuildMetadata({ WORKERS_CI: "1", WORKERS_CI_BRANCH: "main", WORKERS_CI_COMMIT_SHA: "short" }),
    /valid WORKERS_CI_COMMIT_SHA/,
  );
});

test("production deploy is strict, SHA-labelled and readiness-checked", async () => {
  const calls = [];
  await deployProduction({
    env: { WORKERS_CI: "1", WORKERS_CI_BRANCH: "main", WORKERS_CI_COMMIT_SHA: SHA },
    spawn: (command, args) => {
      calls.push([command, ...args]);
      return { status: 0 };
    },
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, service: "skvallerbyttan", check: "configuration" }), {
      status: 200,
      headers: { "content-type": "application/json; charset=utf-8" },
    }),
    sleep: async () => {},
  });

  assert.deepEqual(calls, [["wrangler", "deploy", "--strict", "--message", `Git ${SHA}`]]);
});

test("readiness check requires the exact healthy payload", async () => {
  await validateReadinessResponse(new Response(JSON.stringify({ ok: true, service: "skvallerbyttan", check: "configuration" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));

  await assert.rejects(
    validateReadinessResponse(new Response(JSON.stringify({ ok: false, service: "skvallerbyttan", check: "configuration" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })),
    /expected 200/,
  );

  await assert.rejects(
    validateReadinessResponse(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })),
    /unexpected readiness payload/,
  );
});
