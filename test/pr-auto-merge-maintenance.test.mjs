import assert from 'node:assert/strict';
import test from 'node:test';

import { runMaintenance } from '../scripts/pr-auto-merge-maintenance.mjs';

function makePull(number, overrides = {}) {
  return {
    number,
    node_id: `PR_${number}`,
    state: 'open',
    draft: false,
    auto_merge: { enabled_by: { login: 'test' } },
    base: {
      ref: 'main',
      sha: 'base-old',
      repo: { full_name: 'Avkroken/Testrepo' },
    },
    head: {
      ref: `branch-${number}`,
      sha: `head-${number}`,
      repo: { full_name: 'Avkroken/Testrepo' },
    },
    ...overrides,
  };
}

function makeCore() {
  const info = [];
  const warning = [];
  return {
    info: (message) => info.push(message),
    warning: (message) => warning.push(message),
    messages: { info, warning },
  };
}

function makePaginate({
  listForOrg,
  listPulls,
  repositoryPages,
  pullPages,
  onRepositoryPage,
  onPullPage,
}) {
  const paginate = async () => {
    throw new Error('direct paginate should not be used');
  };

  paginate.iterator = (method) => {
    const pages = method === listForOrg ? repositoryPages : pullPages;
    const onPage = method === listForOrg ? onRepositoryPage : onPullPage;
    let index = 0;

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      async next() {
        if (index >= pages.length) return { done: true, value: undefined };
        onPage?.(index);
        const value = { data: pages[index] };
        index += 1;
        return { done: false, value };
      },
    };
  };

  return paginate;
}

test('bounded workers stop before the shared run deadline with many slow PRs', async () => {
  const listForOrg = () => {};
  const listPulls = () => {};
  const pulls = Array.from({ length: 8 }, (_, index) => makePull(index + 1));
  const core = makeCore();
  let clock = 0;
  let updates = 0;
  let graphQlCalls = 0;

  const github = {
    paginate: makePaginate({
      listForOrg,
      listPulls,
      repositoryPages: [[{ name: 'Testrepo', default_branch: 'main', archived: false, disabled: false }]],
      pullPages: [pulls],
    }),
    rest: {
      repos: {
        listForOrg,
        compareCommitsWithBasehead: async () => ({ data: { behind_by: 1 } }),
      },
      pulls: {
        list: listPulls,
        get: async ({ pull_number }) => ({ data: makePull(pull_number) }),
        updateBranch: async () => {
          updates += 1;
          return { data: {} };
        },
      },
      git: {
        getRef: async ({ ref }) => ({ data: { object: { sha: ref.includes('main') ? 'base-new' : 'head-new' } } }),
      },
    },
    graphql: async () => {
      graphQlCalls += 1;
      return {};
    },
  };

  await runMaintenance({
    github,
    core,
    owner: 'Avkroken',
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    runBudgetMs: 100,
    pollBudgetMs: 1000,
    pollIntervalMs: 25,
    maxConcurrency: 4,
  });

  assert.equal(clock, 100);
  assert.equal(updates, 4);
  assert.equal(graphQlCalls, 0);
  assert.ok(core.messages.warning.some((message) => message.includes('4/8')));
});

test('repository pagination stops before requesting another page after the deadline', async () => {
  const listForOrg = () => {};
  const listPulls = () => {};
  const core = makeCore();
  let clock = 0;
  let repositoryPageCalls = 0;

  const github = {
    paginate: makePaginate({
      listForOrg,
      listPulls,
      repositoryPages: [
        [{ name: 'Testrepo', default_branch: 'main', archived: false, disabled: false }],
        [{ name: 'Otherrepo', default_branch: 'main', archived: false, disabled: false }],
      ],
      pullPages: [[]],
      onRepositoryPage: () => {
        repositoryPageCalls += 1;
        clock = 100;
      },
    }),
    rest: {
      repos: { listForOrg },
      pulls: { list: listPulls },
    },
  };

  await runMaintenance({
    github,
    core,
    owner: 'Avkroken',
    now: () => clock,
    runBudgetMs: 100,
  });

  assert.equal(repositoryPageCalls, 1);
  assert.ok(core.messages.warning.some((message) => message.includes('repository-listningen')));
});

test('PR pagination stops before requesting another page after the deadline', async () => {
  const listForOrg = () => {};
  const listPulls = () => {};
  const core = makeCore();
  let clock = 0;
  let pullPageCalls = 0;

  const github = {
    paginate: makePaginate({
      listForOrg,
      listPulls,
      repositoryPages: [[{ name: 'Testrepo', default_branch: 'main', archived: false, disabled: false }]],
      pullPages: [[makePull(1)], [makePull(2)]],
      onPullPage: () => {
        pullPageCalls += 1;
        clock = 100;
      },
    }),
    rest: {
      repos: { listForOrg },
      pulls: { list: listPulls },
    },
  };

  await runMaintenance({
    github,
    core,
    owner: 'Avkroken',
    now: () => clock,
    runBudgetMs: 100,
  });

  assert.equal(pullPageCalls, 1);
  assert.ok(core.messages.warning.some((message) => message.includes('PR-listningen')));
});

test('does not re-arm a PR that stops qualifying after the branch update', async () => {
  const listForOrg = () => {};
  const listPulls = () => {};
  const core = makeCore();
  let getCalls = 0;
  let compareCalls = 0;
  let updates = 0;
  let graphQlCalls = 0;

  const github = {
    paginate: makePaginate({
      listForOrg,
      listPulls,
      repositoryPages: [[{ name: 'Testrepo', default_branch: 'main', archived: false, disabled: false }]],
      pullPages: [[makePull(1)]],
    }),
    rest: {
      repos: {
        listForOrg,
        compareCommitsWithBasehead: async () => {
          compareCalls += 1;
          return { data: { behind_by: compareCalls === 1 ? 1 : 0 } };
        },
      },
      pulls: {
        list: listPulls,
        get: async () => {
          getCalls += 1;
          if (getCalls === 1) return { data: makePull(1) };
          return {
            data: makePull(1, {
              draft: true,
              auto_merge: null,
            }),
          };
        },
        updateBranch: async () => {
          updates += 1;
          return { data: {} };
        },
      },
      git: {
        getRef: async ({ ref }) => ({ data: { object: { sha: ref.includes('main') ? 'base-new' : 'head-new' } } }),
      },
    },
    graphql: async () => {
      graphQlCalls += 1;
      return {};
    },
  };

  await runMaintenance({
    github,
    core,
    owner: 'Avkroken',
    now: () => 0,
    sleep: async () => {},
    runBudgetMs: 1000,
    pollBudgetMs: 100,
    pollIntervalMs: 1,
    maxConcurrency: 1,
  });

  assert.equal(updates, 1);
  assert.equal(graphQlCalls, 0);
  assert.ok(core.messages.info.some((message) => message.includes('återarmeras inte')));
});

test('re-arms a still-qualified PR only after its branch update is current', async () => {
  const listForOrg = () => {};
  const listPulls = () => {};
  const core = makeCore();
  let getCalls = 0;
  let compareCalls = 0;
  let graphQlCalls = 0;

  const github = {
    paginate: makePaginate({
      listForOrg,
      listPulls,
      repositoryPages: [[{ name: 'Testrepo', default_branch: 'main', archived: false, disabled: false }]],
      pullPages: [[makePull(1)]],
    }),
    rest: {
      repos: {
        listForOrg,
        compareCommitsWithBasehead: async () => {
          compareCalls += 1;
          return { data: { behind_by: compareCalls === 1 ? 1 : 0 } };
        },
      },
      pulls: {
        list: listPulls,
        get: async () => {
          getCalls += 1;
          if (getCalls === 1) return { data: makePull(1) };
          return { data: makePull(1, { auto_merge: null }) };
        },
        updateBranch: async () => ({ data: {} }),
      },
      git: {
        getRef: async ({ ref }) => ({ data: { object: { sha: ref.includes('main') ? 'base-new' : 'head-new' } } }),
      },
    },
    graphql: async (_query, variables) => {
      graphQlCalls += 1;
      assert.equal(variables.pullRequestId, 'PR_1');
      return {};
    },
  };

  await runMaintenance({
    github,
    core,
    owner: 'Avkroken',
    now: () => 0,
    sleep: async () => {},
    runBudgetMs: 1000,
    pollBudgetMs: 100,
    pollIntervalMs: 1,
    maxConcurrency: 1,
  });

  assert.equal(graphQlCalls, 1);
});
