import assert from "node:assert/strict";
import test from "node:test";
import {
  MAX_WEBHOOK_BYTES,
  declaredWebhookBodyTooLarge,
  githubDeliveryId,
  readWebhookBody,
  verifyWebhookSignature,
  webhookBodyTooLarge,
  WebhookBodyTooLargeError,
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

test("normalizes GitHub delivery ids and rejects missing values", () => {
  assert.equal(githubDeliveryId(new Headers({ "x-github-delivery": " 1234-abcd " })), "1234-abcd");
  assert.equal(githubDeliveryId(new Headers({ "x-github-delivery": "   " })), null);
  assert.equal(githubDeliveryId(new Headers()), null);
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

test("reads a streamed webhook body inside the byte limit", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("hello "));
      controller.enqueue(new TextEncoder().encode("world"));
      controller.close();
    },
  });

  assert.equal(await readWebhookBody(stream), "hello world");
});

test("aborts streamed webhook bodies once the byte limit is exceeded", async () => {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(MAX_WEBHOOK_BYTES));
      controller.enqueue(Uint8Array.of(1));
      controller.close();
    },
  });

  await assert.rejects(readWebhookBody(stream), WebhookBodyTooLargeError);
});
