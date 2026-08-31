import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const dispatcher = require("../.github/scripts/codex-security-dispatch.cjs") as {
  collectSecurityIssues?: (github: unknown, repositories: Array<{ name: string; owner: { login: string } }>) => Promise<Array<{ body?: string; pull_request?: unknown }>>;
  run?: unknown;
  verifyMergeGates?: (github: any, owner: string, repo: string, pullNumber: number) => Promise<{ ok: boolean; reason?: string; headSha?: string; baseSha?: string }>;
};

test("security dispatcher module loads and exports its runner", () => {
  assert.equal(typeof dispatcher.run, "function");
  assert.equal(typeof dispatcher.collectSecurityIssues, "function");
  assert.equal(typeof dispatcher.verifyMergeGates, "function");
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

function mergeGateGithub(
  contexts: Array<Record<string, unknown>>,
  threads: Array<{ isResolved: boolean }> = [],
  compareStatus = "ahead",
) {
  const pull = {
    state: "open",
    number: 7,
    head: { sha: "head-sha" },
    base: { sha: "base-sha", ref: "main" },
  };
  const rules = [
    {
      type: "pull_request",
      parameters: {
        allowed_merge_methods: ["squash"],
        required_approving_review_count: 0,
        require_code_owner_review: false,
        require_last_push_approval: false,
        required_review_thread_resolution: true,
      },
    },
    {
      type: "required_status_checks",
      parameters: {
        strict_required_status_checks_policy: true,
        required_status_checks: [
          { context: "CI / required", integration_id: 15368 },
          { context: "scan-pr / osv-scan", integration_id: 15368 },
        ],
      },
    },
    {
      type: "code_scanning",
      parameters: {
        code_scanning_tools: [{ tool: "CodeQL" }],
      },
    },
  ];

  return {
    rest: {
      pulls: {
        async get() {
          return { data: pull };
        },
      },
      repos: {
        async compareCommitsWithBasehead() {
          return { data: { status: compareStatus } };
        },
      },
    },
    async paginate() {
      return rules;
    },
    async graphql() {
      return {
        repository: {
          pullRequest: {
            headRefOid: "head-sha",
            reviewThreads: {
              nodes: threads,
              pageInfo: { hasNextPage: false },
            },
            commits: {
              nodes: [
                {
                  commit: {
                    oid: "head-sha",
                    statusCheckRollup: {
                      contexts: {
                        nodes: contexts,
                        pageInfo: { hasNextPage: false },
                      },
                    },
                  },
                },
              ],
            },
          },
        },
      };
    },
  };
}

const successfulContexts = [
  {
    __typename: "CheckRun",
    name: "CI / required",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    app: { databaseId: 15368 },
  },
  {
    __typename: "CheckRun",
    name: "scan-pr / osv-scan",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    app: { databaseId: 15368 },
  },
  {
    __typename: "CheckRun",
    name: "CodeQL",
    status: "COMPLETED",
    conclusion: "SUCCESS",
    app: { databaseId: 57789 },
  },
];

test("merge gate verification passes only when strict base, required checks, CodeQL and threads are green", async () => {
  const result = await dispatcher.verifyMergeGates?.(
    mergeGateGithub(successfulContexts),
    "Avkroken",
    "example",
    7,
  );

  assert.deepEqual(result, {
    ok: true,
    headSha: "head-sha",
    baseSha: "base-sha",
  });
});

test("merge gate verification fails closed on a pending required check", async () => {
  const contexts = successfulContexts.map(context =>
    context.name === "CI / required"
      ? { ...context, status: "IN_PROGRESS", conclusion: null }
      : context
  );

  const result = await dispatcher.verifyMergeGates?.(
    mergeGateGithub(contexts),
    "Avkroken",
    "example",
    7,
  );

  assert.equal(result?.ok, false);
  assert.equal(result?.reason, "required-check-not-success:CI / required");
});

test("merge gate verification fails closed on unresolved review threads", async () => {
  const result = await dispatcher.verifyMergeGates?.(
    mergeGateGithub(successfulContexts, [{ isResolved: false }]),
    "Avkroken",
    "example",
    7,
  );

  assert.equal(result?.ok, false);
  assert.equal(result?.reason, "unresolved-review-thread");
});

test("merge gate verification fails closed when strict policy sees an outdated base", async () => {
  const result = await dispatcher.verifyMergeGates?.(
    mergeGateGithub(successfulContexts, [], "diverged"),
    "Avkroken",
    "example",
    7,
  );

  assert.equal(result?.ok, false);
  assert.equal(result?.reason, "head-not-current-with-base");
});
