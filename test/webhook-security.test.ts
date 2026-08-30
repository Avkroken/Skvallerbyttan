import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WEBHOOK_BYTES,
  declaredWebhookBodyTooLarge,
  verifyWebhookSignature,
  webhookBodyTooLarge,
} from "../src/webhook-security";

const VALID_HELLO_SIGNATURE = "sha256=88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b";

test("accepts a known HMAC-SHA256 webhook signature", async () => {
  assert.equal(await verifyWebhookSignature("hello", VALID_HELLO_SIGNATURE, "secret"), true);
});

test("rejects a signature when the body changes", async () => {
  assert.equal(await verifyWebhookSignature("hello!", VALID_HELLO_SIGNATURE, "secret"), false);
});

test("rejects missing or malformed webhook signatures", async () => {
  assert.equal(await verifyWebhookSignature("hello", null, "secret"), false);
  assert.equal(await verifyWebhookSignature("hello", "88aab3ede8d3adf94d26ab90d3bafd4a2083070c3bcce9c014ee04a443847c0b", "secret"), false);
  assert.equal(await verifyWebhookSignature("hello", VALID_HELLO_SIGNATURE, ""), false);
});

test("rejects declared payloads above the limit", () => {
  assert.equal(declaredWebhookBodyTooLarge(String(MAX_WEBHOOK_BYTES)), false);
  assert.equal(declaredWebhookBodyTooLarge(String(MAX_WEBHOOK_BYTES + 1)), true);
  assert.equal(declaredWebhookBodyTooLarge(null), false);
  assert.equal(declaredWebhookBodyTooLarge("not-a-number"), false);
});

test("measures the actual UTF-8 webhook body", () => {
  assert.equal(webhookBodyTooLarge("a".repeat(MAX_WEBHOOK_BYTES)), false);
  assert.equal(webhookBodyTooLarge("a".repeat(MAX_WEBHOOK_BYTES + 1)), true);
  assert.equal(webhookBodyTooLarge("å".repeat(MAX_WEBHOOK_BYTES / 2 + 1)), true);
});
