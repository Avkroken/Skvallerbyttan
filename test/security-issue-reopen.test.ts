import assert from "node:assert/strict";
import test from "node:test";
import { closedSecurityIssueQuery, reopenClosedSecurityIssue } from "../src/security-issue-reopen";

test("builds an exact closed security issue query", () => {
  assert.equal(
    closedSecurityIssueQuery("Avkroken/example", "skvallerbyttan-alert:dependabot:17"),
    'repo:Avkroken/example is:issue is:closed in:body "skvallerbyttan-alert:dependabot:17"',
  );
});

test("reopens the matching closed security issue", async () => {
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  const request = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, ...(init?.body ? { body: String(init.body) } : {}) });
    if (calls.length === 1) {
      return Response.json({ items: [{ number: 42 }] });
    }
    return Response.json({ number: 42, state: "open" });
  };

  const issueNumber = await reopenClosedSecurityIssue(
    "token",
    "Avkroken/example",
    "skvallerbyttan-alert:code-scanning:4",
    request,
  );

  assert.equal(issueNumber, 42);
  assert.equal(calls.length, 2);
  assert.equal(calls[0]?.method, "GET");
  assert.equal(calls[0]?.url.includes("search/issues?q="), true);
  assert.equal(calls[1]?.url, "https://api.github.com/repos/Avkroken/example/issues/42");
  assert.equal(calls[1]?.method, "PATCH");
  assert.equal(calls[1]?.body, JSON.stringify({ state: "open" }));
});

test("leaves state unchanged when no closed issue matches", async () => {
  let calls = 0;
  const issueNumber = await reopenClosedSecurityIssue(
    "token",
    "Avkroken/example",
    "skvallerbyttan-alert:secret-scanning:7",
    async () => {
      calls += 1;
      return Response.json({ items: [] });
    },
  );

  assert.equal(issueNumber, null);
  assert.equal(calls, 1);
});
