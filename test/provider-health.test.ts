import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import { getProviderHealth } from "../src/provider-health";

test("provider health does not claim unobserved credentials are live", () => {
  const state = getProviderHealth({
    GAMNACKEN_GITHUB_APP_CLIENT_ID: "app",
    GAMNACKEN_GITHUB_APP_PRIVATE_KEY: "key",
    CLOUDFLARE_ACCOUNT_ID: "account",
    CLOUDFLARE_API_TOKEN_R1: "token",
  } as Env) as any;

  assert.equal(state.providers.github.status, "not_observed");
  assert.equal(state.providers.cloudflare.status, "not_observed");
  assert.equal(state.providers.github.reconciliation.status, "unknown");
});
