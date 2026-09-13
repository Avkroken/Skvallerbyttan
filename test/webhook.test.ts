import assert from "node:assert/strict";
import test from "node:test";
import { verifyWebhookSignature, webhookCacheKeys } from "../src/webhook";

test("verifies GitHub's documented SHA-256 webhook test vector", async () => {
  const valid = await verifyWebhookSignature(
    "Hello, World!",
    "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
    "It's a Secret to Everybody",
  );
  assert.equal(valid, true);
});

test("rejects invalid webhook signatures", async () => {
  assert.equal(await verifyWebhookSignature("payload", "sha256=00", "secret"), false);
  assert.equal(await verifyWebhookSignature("payload", null, "secret"), false);
});

test("repository activity invalidates overview and only that repository's deep caches", () => {
  assert.deepEqual(webhookCacheKeys("workflow_run", "Politiker"), [
    "overview",
    "repository:Politiker",
    "insights:Politiker",
  ]);
  assert.deepEqual(webhookCacheKeys("code_scanning_alert", "Bastion"), [
    "overview",
    "repository:Bastion",
    "insights:Bastion",
  ]);
});

test("irrelevant webhook events do not invalidate dashboard cache", () => {
  assert.deepEqual(webhookCacheKeys("ping", null), []);
});
