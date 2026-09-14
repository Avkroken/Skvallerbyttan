import assert from "node:assert/strict";
import test from "node:test";
import { singleFlight } from "../src/single-flight";

test("singleFlight reuses one in-flight promise per key", async () => {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;

  const first = singleFlight("overview", async () => {
    calls += 1;
    await gate;
    return "first";
  });
  const second = singleFlight("overview", async () => {
    calls += 1;
    return "second";
  });

  assert.equal(first, second);
  assert.equal(calls, 0);

  await Promise.resolve();
  assert.equal(calls, 1);

  release();
  assert.equal(await first, "first");
  assert.equal(await second, "first");

  const third = singleFlight("overview", async () => {
    calls += 1;
    return "third";
  });
  assert.equal(await third, "third");
  assert.equal(calls, 2);
});

test("singleFlight clears a failed in-flight promise", async () => {
  let calls = 0;
  let rejected = false;

  try {
    await singleFlight("repository:Bastion", async () => {
      calls += 1;
      throw new Error("boom");
    });
  } catch (error) {
    rejected = true;
    assert.equal(error instanceof Error, true);
    if (error instanceof Error) assert.equal(error.message, "boom");
  }
  assert.equal(rejected, true);

  const result = await singleFlight("repository:Bastion", async () => {
    calls += 1;
    return "recovered";
  });

  assert.equal(result, "recovered");
  assert.equal(calls, 2);
});
