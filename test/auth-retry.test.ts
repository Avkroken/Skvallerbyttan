import assert from "node:assert/strict";
import test from "node:test";
import { retryOnceAfterUnauthorized } from "../src/auth-retry";

test("retryOnceAfterUnauthorized refreshes and retries exactly once after 401", async () => {
  const requestedTokens: string[] = [];
  const refreshedTokens: string[] = [];

  const response = await retryOnceAfterUnauthorized(
    async () => "stale-token",
    async (rejectedToken) => {
      refreshedTokens.push(rejectedToken);
      return "fresh-token";
    },
    async (token) => {
      requestedTokens.push(token);
      return new Response(null, { status: token === "stale-token" ? 401 : 200 });
    },
  );

  assert.equal(response.status, 200);
  assert.deepEqual(requestedTokens, ["stale-token", "fresh-token"]);
  assert.deepEqual(refreshedTokens, ["stale-token"]);
});

test("retryOnceAfterUnauthorized does not loop after a second 401", async () => {
  let requests = 0;
  let refreshes = 0;

  const response = await retryOnceAfterUnauthorized(
    async () => "stale-token",
    async () => {
      refreshes += 1;
      return "fresh-token";
    },
    async () => {
      requests += 1;
      return new Response(null, { status: 401 });
    },
  );

  assert.equal(response.status, 401);
  assert.equal(requests, 2);
  assert.equal(refreshes, 1);
});

test("retryOnceAfterUnauthorized leaves non-401 responses untouched", async () => {
  let refreshes = 0;

  const response = await retryOnceAfterUnauthorized(
    async () => "token",
    async () => {
      refreshes += 1;
      return "unused";
    },
    async () => new Response(null, { status: 403 }),
  );

  assert.equal(response.status, 403);
  assert.equal(refreshes, 0);
});
