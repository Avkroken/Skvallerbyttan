import assert from "node:assert/strict";
import test from "node:test";
import { OPERATION_STALE_AFTER_MS, shouldClaimOperation } from "../src/idempotency";

test("claims an operation with no prior record", () => {
  assert.equal(shouldClaimOperation(undefined, 1_000), true);
});

test("does not reclaim an active operation", () => {
  assert.equal(shouldClaimOperation({ status: "processing", updatedAt: 1_000 }, 1_001), false);
});

test("reclaims a stale processing operation", () => {
  assert.equal(
    shouldClaimOperation(
      { status: "processing", updatedAt: 1_000 },
      1_000 + OPERATION_STALE_AFTER_MS,
    ),
    true,
  );
});

test("never reclaims a completed operation", () => {
  assert.equal(
    shouldClaimOperation(
      { status: "completed", updatedAt: 1_000 },
      1_000 + OPERATION_STALE_AFTER_MS * 10,
    ),
    false,
  );
});
