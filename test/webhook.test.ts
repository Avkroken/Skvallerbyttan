import assert from "node:assert/strict";
import test from "node:test";
import { portalDocsInvalidation, verifyWebhookSignature, webhookCacheKeys } from "../src/webhook";

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


test("documentation pushes signal the portal only from the public default branch", () => {
  const base = {
    ref: "refs/heads/main",
    size: 1,
    repository: {
      name: "Skvallerbyttan",
      default_branch: "main",
      private: false,
      visibility: "public",
      owner: { login: "Avkroken" },
    },
  };

  assert.deepEqual(portalDocsInvalidation("push", {
    ...base,
    commits: [{ added: [], modified: ["docs/architecture.md"], removed: [] }],
  }), {
    repositoryName: "Skvallerbyttan",
    previousRepositoryName: null,
  });

  assert.equal(portalDocsInvalidation("push", {
    ...base,
    commits: [{ added: [], modified: ["src/worker.ts"], removed: [] }],
  }), null);

  assert.equal(portalDocsInvalidation("push", {
    ...base,
    ref: "refs/heads/dev",
    commits: [{ added: [], modified: ["docs/architecture.md"], removed: [] }],
  }), null);
});

test("repository rename invalidates both current and previous portal documentation tags", () => {
  assert.deepEqual(portalDocsInvalidation("repository", {
    repository: {
      name: "Skvallerbyttan",
      owner: { login: "Avkroken" },
    },
    changes: {
      repository: {
        name: { from: "Gamla-Skvallerbyttan" },
      },
    },
  }), {
    repositoryName: "Skvallerbyttan",
    previousRepositoryName: "Gamla-Skvallerbyttan",
  });
});
