import assert from "node:assert/strict";
import test from "node:test";
import { ExpiringValueCache } from "../src/expiring-value-cache";

test("ExpiringValueCache reuses a value outside the safety window", async () => {
  let clock = 100_000;
  let calls = 0;
  const cache = new ExpiringValueCache<string>(60_000, () => clock);
  const load = async () => {
    calls += 1;
    return { value: `token-${calls}`, expiresAt: 1_000_000 };
  };

  assert.equal(await cache.get(load), "token-1");
  clock = 200_000;
  assert.equal(await cache.get(load), "token-1");
  assert.equal(calls, 1);
});

test("ExpiringValueCache reloads inside the safety window", async () => {
  let clock = 100_000;
  let calls = 0;
  const cache = new ExpiringValueCache<string>(60_000, () => clock);
  const load = async () => {
    calls += 1;
    return { value: `token-${calls}`, expiresAt: calls === 1 ? 200_000 : 500_000 };
  };

  assert.equal(await cache.get(load), "token-1");
  clock = 150_000;
  assert.equal(await cache.get(load), "token-2");
  assert.equal(calls, 2);
});

test("ExpiringValueCache rejects a newly loaded value inside the safety window", async () => {
  const cache = new ExpiringValueCache<string>(60_000, () => 100_000);

  await assert.rejects(
    () => cache.get(async () => ({ value: "near-expiry", expiresAt: 150_000 })),
    /safety window/,
  );
});

test("ExpiringValueCache rechecks current time after loading", async () => {
  let clock = 100_000;
  const cache = new ExpiringValueCache<string>(60_000, () => clock);

  await assert.rejects(
    () => cache.get(async () => {
      clock = 150_000;
      return { value: "near-expiry", expiresAt: 200_000 };
    }),
    /safety window/,
  );
});

test("ExpiringValueCache getFresh bypasses a reusable cached value", async () => {
  let calls = 0;
  const cache = new ExpiringValueCache<string>(60_000, () => 100_000);
  const load = async () => {
    calls += 1;
    return { value: `token-${calls}`, expiresAt: 500_000 };
  };

  assert.equal(await cache.get(load), "token-1");
  assert.equal(await cache.getFresh(load), "token-2");
  assert.equal(await cache.get(load), "token-2");
  assert.equal(calls, 2);
});

test("ExpiringValueCache invalidates only the rejected current value", async () => {
  let calls = 0;
  const cache = new ExpiringValueCache<string>(60_000, () => 100_000);
  const load = async () => {
    calls += 1;
    return { value: `token-${calls}`, expiresAt: 500_000 };
  };

  assert.equal(await cache.get(load), "token-1");
  cache.invalidate("different-token");
  assert.equal(await cache.get(load), "token-1");
  cache.invalidate("token-1");
  assert.equal(await cache.get(load), "token-2");
  assert.equal(calls, 2);
});

test("ExpiringValueCache shares an in-flight load", async () => {
  let calls = 0;
  let resolveLoad: ((value: { value: string; expiresAt: number }) => void) | undefined;
  const cache = new ExpiringValueCache<string>(60_000, () => 100_000);
  const load = () => {
    calls += 1;
    return new Promise<{ value: string; expiresAt: number }>((resolve) => {
      resolveLoad = resolve;
    });
  };

  const first = cache.get(load);
  const second = cache.get(load);
  resolveLoad?.({ value: "shared", expiresAt: 500_000 });

  assert.equal(await first, "shared");
  assert.equal(await second, "shared");
  assert.equal(calls, 1);
});

test("ExpiringValueCache retries after a failed load", async () => {
  let calls = 0;
  const cache = new ExpiringValueCache<string>(60_000, () => 100_000);
  const load = async () => {
    calls += 1;
    if (calls === 1) throw new Error("temporary failure");
    return { value: "recovered", expiresAt: 500_000 };
  };

  await assert.rejects(() => cache.get(load), /temporary failure/);
  assert.equal(await cache.get(load), "recovered");
  assert.equal(calls, 2);
});
