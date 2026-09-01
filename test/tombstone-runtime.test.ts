import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/worker";

const env = {} as Parameters<typeof worker.fetch>[1];
const ctx = {} as Parameters<typeof worker.fetch>[2];

test("ready exposes only the decommission marker", async () => {
  const response = await worker.fetch(
    new Request("https://skvallerbyttan.denied.se/ready"),
    env,
    ctx,
  );

  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /application\/json/i);
  assert.deepEqual(await response.json(), {
    ok: true,
    service: "skvallerbyttan",
    check: "decommissioned",
  });
});

test("all non-ready HTTP requests are gone", async () => {
  for (const [method, path] of [
    ["GET", "/"],
    ["GET", "/health"],
    ["POST", "/webhook"],
    ["POST", "/ready"],
  ] as const) {
    const response = await worker.fetch(
      new Request(`https://skvallerbyttan.denied.se${path}`, { method }),
      env,
      ctx,
    );
    assert.equal(response.status, 410, `${method} ${path}`);
  }
});

test("scheduled handling is inert", async () => {
  await assert.doesNotReject(
    worker.scheduled(
      {} as ScheduledController,
      env,
      {} as ExecutionContext,
    ),
  );
});
