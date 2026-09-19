import assert from "node:assert/strict";
import test from "node:test";
import {
  evaluateWorkflowEventPolicies,
  normalizeActionsPolicy,
  normalizeRuleset,
  workflowPathMatches,
} from "../src/github-governance";

test("normalizes workflow execution protection actors and event rules", () => {
  const normalized = normalizeActionsPolicy({
    id: 10,
    name: "Labeler pull target",
    target: "actions",
    enforcement: "active",
    conditions: {
      workflow_path: {
        include: [".github/workflows/labeler.yml", ".github/workflows/auto-assign.yml"],
        exclude: [],
      },
    },
    rules: [
      { type: "restrict_action_events", parameters: { allowed_events: ["issues", "pull_request_target"] } },
      { type: "restrict_actions_actors", parameters: { allowed_actors: [] } },
    ],
  }) as any;

  assert.deepEqual(normalized.conditions.workflowPath.include, [
    ".github/workflows/labeler.yml",
    ".github/workflows/auto-assign.yml",
  ]);
  assert.deepEqual(normalized.rules[0].allowedEvents, ["issues", "pull_request_target"]);
  assert.deepEqual(normalized.rules[1].allowedActors, []);
});

test("pull_request_target regression fixture represents path-scoped allow without bypass", () => {
  const policies = [
    {
      id: 1,
      name: "Block pull_request_target",
      enforcement: "active",
      conditions: {
        workflow_path: {
          include: ["~ALL"],
          exclude: [".github/workflows/labeler.yml", ".github/workflows/auto-assign.yml"],
        },
      },
      rules: [{ type: "restrict_action_events", parameters: { allowed_events: ["push", "pull_request", "issues"] } }],
      bypass_actors: [],
    },
    {
      id: 2,
      name: "Allow metadata pull target",
      enforcement: "active",
      conditions: {
        workflow_path: {
          include: [".github/workflows/labeler.yml", ".github/workflows/auto-assign.yml"],
          exclude: [],
        },
      },
      rules: [{ type: "restrict_action_events", parameters: { allowed_events: ["issues", "pull_request_target"] } }],
      bypass_actors: [],
    },
  ];

  assert.equal(
    (evaluateWorkflowEventPolicies(policies, ".github/workflows/labeler.yml", "pull_request_target") as any).status,
    "allowed",
  );
  assert.equal(
    (evaluateWorkflowEventPolicies(policies, ".github/workflows/build.yml", "pull_request_target") as any).status,
    "blocked",
  );
  assert.equal(
    (evaluateWorkflowEventPolicies(policies, ".github/workflows/auto-assign.yml", "issues") as any).status,
    "allowed",
  );
});

test("workflow path conditions support exact, wildcard and ~ALL semantics", () => {
  assert.equal(workflowPathMatches({ include: ["~ALL"], exclude: ["safe/*.yml"] }, ".github/workflows/x.yml"), true);
  assert.equal(workflowPathMatches({ include: ["safe/*.yml"], exclude: [] }, "safe/one.yml"), true);
  assert.equal(workflowPathMatches({ include: ["safe/*.yml"], exclude: [] }, "other/one.yml"), false);
});

test("ruleset provenance distinguishes repository direct from inherited organization state", () => {
  const inherited = normalizeRuleset({
    id: 123,
    name: "main-node",
    source_type: "Organization",
    source: "Avkroken",
    enforcement: "active",
    rules: [{ type: "workflows", parameters: { workflows: [{ repository_id: 1, path: ".github/workflows/node.yml" }] } }],
  }, "2026-09-19T08:00:00.000Z") as any;
  assert.equal(inherited.provenance.inherited, true);
  assert.equal(inherited.provenance.direct, false);
  assert.equal(inherited.provenance.derived, false);
});
