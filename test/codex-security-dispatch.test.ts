import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const dispatcher = require("../.github/scripts/codex-security-dispatch.cjs") as { run?: unknown };

test("security dispatcher module loads and exports its runner", () => {
  assert.equal(typeof dispatcher.run, "function");
});
