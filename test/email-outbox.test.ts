import assert from "node:assert/strict";
import test from "node:test";
import {
  EMAIL_RETRY_MAX_MS,
  emailOutboxName,
  emailRetryDelayMs,
  normalizeQueuedEmail,
} from "../src/email-outbox";

test("email retry uses bounded exponential backoff", () => {
  assert.equal(emailRetryDelayMs(1), 60_000);
  assert.equal(emailRetryDelayMs(2), 120_000);
  assert.equal(emailRetryDelayMs(3), 240_000);
  assert.equal(emailRetryDelayMs(100), EMAIL_RETRY_MAX_MS);
});

test("email outbox is isolated by webhook delivery", () => {
  assert.equal(emailOutboxName("delivery-guid"), "email:delivery-guid");
});

test("queued email normalization keeps only serializable message fields", () => {
  assert.deepEqual(
    normalizeQueuedEmail({
      to: " security@example.test ",
      from: { email: " sender@example.test ", name: " Skvallerbyttan " },
      subject: " Alert ",
      text: "plain",
      html: "<p>html</p>",
      ignored: { rawPayload: true },
    }),
    {
      to: "security@example.test",
      from: { email: "sender@example.test", name: "Skvallerbyttan" },
      subject: "Alert",
      text: "plain",
      html: "<p>html</p>",
    },
  );
});

test("queued email normalization rejects missing envelope fields", async () => {
  await assert.rejects(async () => normalizeQueuedEmail({ subject: "missing recipients" }), /required envelope fields/);
});
