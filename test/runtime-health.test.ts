import assert from "node:assert/strict";
import test from "node:test";
import { runtimeReady } from "../src/runtime-health";

const completeEnv = {
  SKVALLERBYTTAN_WEBHOOK_SECRET: "secret",
  SKVALLERBYTTAN_CLIENT_ID: "client",
  SKVALLERBYTTAN_APP_PRIVATE_KEY: "key",
  SKVALLERBYTTAN_EMAIL_TO: "to@example.test",
  SKVALLERBYTTAN_EMAIL_FROM: "from@example.test",
  EMAIL: {},
  SKVALLERBYTTAN_ISSUE_LOCK: {},
};

test("runtimeReady accepts a complete Worker environment", () => {
  assert.equal(runtimeReady(completeEnv), true);
});

test("runtimeReady fails closed when a required secret is missing", () => {
  assert.equal(runtimeReady({ ...completeEnv, SKVALLERBYTTAN_WEBHOOK_SECRET: "" }), false);
});

test("runtimeReady fails closed when a required binding is missing", () => {
  assert.equal(runtimeReady({ ...completeEnv, EMAIL: undefined }), false);
  assert.equal(runtimeReady({ ...completeEnv, SKVALLERBYTTAN_ISSUE_LOCK: undefined }), false);
});
