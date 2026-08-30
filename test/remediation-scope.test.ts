import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { evaluateRemediationScope, parseAlertReference } = require("../.github/scripts/remediation-scope.cjs") as {
  evaluateRemediationScope: (input: {
    issueBody: string;
    alert: Record<string, unknown>;
    locations?: Array<Record<string, unknown>>;
    files: Array<{ filename: string; previous_filename?: string }>;
  }) => { eligible: boolean; reason: string; expectedPaths: string[]; matchedPath?: string | null };
  parseAlertReference: (body: string) => { type: string; number: number } | null;
};

test("parses Skvallerbyttan alert markers", () => {
  assert.deepEqual(parseAlertReference("<!-- skvallerbyttan-alert:code-scanning:42 -->"), { type: "code-scanning", number: 42 });
  assert.deepEqual(parseAlertReference("skvallerbyttan-alert:dependabot:7"), { type: "dependabot", number: 7 });
  assert.equal(parseAlertReference("no alert marker"), null);
});

test("requires the Code Scanning source path to change", () => {
  const base = {
    issueBody: "<!-- skvallerbyttan-alert:code-scanning:42 -->",
    alert: { state: "open", most_recent_instance: { location: { path: "src/auth.ts" } } },
  };
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: "src/auth.ts" }] }).eligible, true);
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: "README.md" }] }).eligible, false);
});

test("accepts a rename of the Code Scanning source path", () => {
  const result = evaluateRemediationScope({
    issueBody: "<!-- skvallerbyttan-alert:code-scanning:42 -->",
    alert: { state: "open", most_recent_instance: { location: { path: "src/auth.ts" } } },
    files: [{ filename: "src/security/auth.ts", previous_filename: "src/auth.ts" }],
  });
  assert.equal(result.eligible, true);
  assert.equal(result.matchedPath, "src/auth.ts");
});

test("allows Dependabot manifest or sibling lockfile changes", () => {
  const base = {
    issueBody: "<!-- skvallerbyttan-alert:dependabot:9 -->",
    alert: { state: "open", dependency: { manifest_path: "web/package.json" } },
  };
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: "web/package.json" }] }).eligible, true);
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: "web/package-lock.json" }] }).eligible, true);
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: "src/index.ts" }] }).eligible, false);
});

test("requires Secret Scanning commit locations to change", () => {
  const base = {
    issueBody: "<!-- skvallerbyttan-alert:secret-scanning:3 -->",
    alert: { state: "open" },
    locations: [{ type: "commit", details: { path: ".env.example" } }],
  };
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: ".env.example" }] }).eligible, true);
  assert.equal(evaluateRemediationScope({ ...base, files: [{ filename: "README.md" }] }).eligible, false);
});

test("fails closed for non-open alerts and unverifiable locations", () => {
  assert.equal(evaluateRemediationScope({
    issueBody: "<!-- skvallerbyttan-alert:code-scanning:42 -->",
    alert: { state: "dismissed", most_recent_instance: { location: { path: "src/auth.ts" } } },
    files: [{ filename: "src/auth.ts" }],
  }).reason, "alert-not-open");

  assert.equal(evaluateRemediationScope({
    issueBody: "<!-- skvallerbyttan-alert:secret-scanning:3 -->",
    alert: { state: "open" },
    locations: [{ type: "issue", details: {} }],
    files: [{ filename: "README.md" }],
  }).reason, "no-verifiable-alert-path");
});
