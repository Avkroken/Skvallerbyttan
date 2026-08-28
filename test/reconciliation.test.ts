import assert from "node:assert/strict";
import test from "node:test";
import { alertApiPath, alertIsRemediated, alertReference, needsAssignee, reconciledIssueState } from "../src/reconciliation.ts";

test("parses every supported issue marker and rejects invalid alert numbers", () => {
  assert.deepEqual(alertReference("<!-- skvallerbyttan-alert:code-scanning:45 -->"), { type: "code-scanning", number: 45 });
  assert.deepEqual(alertReference("skvallerbyttan-alert:dependabot:9"), { type: "dependabot", number: 9 });
  assert.deepEqual(alertReference("skvallerbyttan-alert:secret-scanning:2"), { type: "secret-scanning", number: 2 });
  assert.equal(alertReference("skvallerbyttan-alert:code-scanning:0"), null);
  assert.equal(alertReference("unrelated"), null);
});

test("builds the repository-scoped GitHub alert endpoint", () => {
  assert.equal(
    alertApiPath("Avkroken/produkter", { type: "code-scanning", number: 65 }),
    "/repos/Avkroken/produkter/code-scanning/alerts/65",
  );
});

test("only fixed or resolved states count as remediation", () => {
  const code = { type: "code-scanning", number: 65 } as const;
  const dependabot = { type: "dependabot", number: 3 } as const;
  const secret = { type: "secret-scanning", number: 4 } as const;
  assert.equal(alertIsRemediated(code, "fixed"), true);
  assert.equal(alertIsRemediated(code, "dismissed"), false);
  assert.equal(alertIsRemediated(dependabot, "fixed"), true);
  assert.equal(alertIsRemediated(dependabot, "auto_dismissed"), false);
  assert.equal(alertIsRemediated(secret, "resolved"), true);
  assert.equal(alertIsRemediated(secret, "open"), false);
  assert.equal(reconciledIssueState(code, "fixed"), "closed");
  assert.equal(reconciledIssueState(code, "open"), "open");
  assert.equal(reconciledIssueState(code, "dismissed"), null);
  assert.equal(reconciledIssueState(secret, "resolved"), "closed");
});

test("detects a missing assignee case-insensitively", () => {
  assert.equal(needsAssignee([], "blixten85"), true);
  assert.equal(needsAssignee([{ login: "Blixten85" }], "blixten85"), false);
  assert.equal(needsAssignee([{ login: "someone-else" }], "blixten85"), true);
});
