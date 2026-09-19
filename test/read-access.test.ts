import assert from "node:assert/strict";
import test from "node:test";
import type { Env } from "../src/env";
import { authorizeReadRequest, secureTokenEqual } from "../src/read-access";

test("read API token comparison is exact", () => {
  assert.equal(secureTokenEqual("abc", "abc"), true);
  assert.equal(secureTokenEqual("abc", "abd"), false);
  assert.equal(secureTokenEqual(null, "abc"), false);
});

test("machine token is read-only consumer attribution for ChatGPT", async () => {
  const env = {
    SKVALLERBYTTAN_READ_API_TOKEN: "read-token",
  } as Env;
  const result = await authorizeReadRequest(
    new Request("https://skvallerbyttan.denied.se/api/v1/capabilities", {
      headers: { Authorization: "Bearer read-token" },
    }),
    env,
  );
  assert.deepEqual(result, { authorized: true, consumer: "chatgpt", userId: null });
});

test("invalid machine token fails closed", async () => {
  const env = {
    SKVALLERBYTTAN_READ_API_TOKEN: "read-token",
  } as Env;
  const result = await authorizeReadRequest(
    new Request("https://skvallerbyttan.denied.se/api/v1/capabilities", {
      headers: { Authorization: "Bearer wrong" },
    }),
    env,
  );
  assert.equal(result.authorized, false);
});
