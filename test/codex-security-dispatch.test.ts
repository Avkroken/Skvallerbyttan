import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const dispatcher = require("../.github/scripts/codex-security-dispatch.cjs") as {
  collectSecurityIssues?: (github: unknown, repositories: Array<{ name: string; owner: { login: string } }>) => Promise<Array<{ body?: string; pull_request?: unknown }>>;
  run?: unknown;
};

test("security dispatcher module loads and exports its runner", () => {
  assert.equal(typeof dispatcher.run, "function");
  assert.equal(typeof dispatcher.collectSecurityIssues, "function");
});

test("security issue discovery paginates every active repository and filters non-security items", async () => {
  const calls: string[] = [];
  const github = {
    rest: { issues: { listForRepo: Symbol("listForRepo") } },
    async paginate(_method: unknown, args: { owner: string; repo: string; state: string; per_page: number }) {
      calls.push(`${args.owner}/${args.repo}:${args.state}:${args.per_page}`);
      return args.repo === "one"
        ? [
            { body: "<!-- skvallerbyttan-alert:dependabot:1 -->" },
            { body: "ordinary issue" },
            { body: "<!-- skvallerbyttan-alert:code-scanning:2 -->", pull_request: {} },
          ]
        : [{ body: "<!-- skvallerbyttan-alert:secret-scanning:3 -->" }];
    },
  };

  const issues = await dispatcher.collectSecurityIssues?.(github, [
    { name: "one", owner: { login: "Avkroken" } },
    { name: "two", owner: { login: "Avkroken" } },
  ]);

  assert.deepEqual(calls, ["Avkroken/one:open:100", "Avkroken/two:open:100"]);
  assert.equal(issues?.length, 2);
});
