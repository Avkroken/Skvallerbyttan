import assert from "node:assert/strict";
import test from "node:test";
import { codeScanningAlertCreatesIssue } from "../src/code-scanning-issue-policy.ts";

const trivyOsPackageAlert = {
  tool: { name: "Trivy" },
  rule: { name: "OsPackageVulnerability" },
};

test("keeps Trivy OS baseline alerts in Code Scanning without duplicate issues for baseline-managed repos", () => {
  assert.equal(codeScanningAlertCreatesIssue("Avkroken/Produkter", trivyOsPackageAlert), false);
  assert.equal(codeScanningAlertCreatesIssue("Avkroken/Docker-idempotent-update", trivyOsPackageAlert), false);
});

test("continues creating issues for other rules, tools, and repositories", () => {
  assert.equal(codeScanningAlertCreatesIssue("Avkroken/Produkter", { tool: { name: "CodeQL" }, rule: { name: "js/xss-through-dom" } }), true);
  assert.equal(codeScanningAlertCreatesIssue("Avkroken/Produkter", { tool: { name: "Trivy" }, rule: { name: "Misconfiguration" } }), true);
  assert.equal(codeScanningAlertCreatesIssue("Avkroken/Politiker", trivyOsPackageAlert), true);
});

test("normalizes punctuation and casing in Trivy rule identifiers", () => {
  assert.equal(codeScanningAlertCreatesIssue("avkroken/produkter", { tool: { name: "trivy" }, rule: { id: "OS-Package-Vulnerability" } }), false);
});
