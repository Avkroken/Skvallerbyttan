const DEFAULT_RUN_BUDGET_MS = 12 * 60 * 1000;
const DEFAULT_POLL_BUDGET_MS = 60 * 1000;
const DEFAULT_POLL_INTERVAL_MS = 3000;
const DEFAULT_CONCURRENCY = 4;

function isQualifiedPull(pull, { owner, repo, base, requireArmed }) {
  const fullName = `${owner}/${repo}`;
  return (
    pull?.state === 'open' &&
    pull?.draft === false &&
    pull?.base?.ref === base &&
    pull?.base?.repo?.full_name === fullName &&
    pull?.head?.repo?.full_name === fullName &&
    (!requireArmed || pull?.auto_merge != null)
  );
}

async function collectPagesUntilDeadline({
  iterator,
  method,
  parameters,
  now,
  deadline,
  onDeadline,
}) {
  const items = [];
  const pages = iterator(method, parameters)[Symbol.asyncIterator]();

  while (now() < deadline) {
    const page = await pages.next();
    if (page.done) return items;
    items.push(...page.value.data);
  }

  onDeadline();
  return items;
}

export async function runMaintenance({
  github,
  core,
  owner,
  now = Date.now,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  runBudgetMs = DEFAULT_RUN_BUDGET_MS,
  pollBudgetMs = DEFAULT_POLL_BUDGET_MS,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxConcurrency = DEFAULT_CONCURRENCY,
}) {
  const deadline = now() + runBudgetMs;
  const tasks = [];

  const repositories = await collectPagesUntilDeadline({
    iterator: github.paginate.iterator,
    method: github.rest.repos.listForOrg,
    parameters: { org: owner, type: 'all', per_page: 100 },
    now,
    deadline,
    onDeadline: () =>
      core.warning('PR-maintainerns tidsbudget tog slut under repository-listningen.'),
  });

  for (const repository of repositories) {
    if (now() >= deadline) break;
    if (repository.archived || repository.disabled) continue;

    const repo = repository.name;
    const base = repository.default_branch;

    let pulls;
    try {
      pulls = await collectPagesUntilDeadline({
        iterator: github.paginate.iterator,
        method: github.rest.pulls.list,
        parameters: { owner, repo, state: 'open', base, per_page: 100 },
        now,
        deadline,
        onDeadline: () =>
          core.warning(`${owner}/${repo}: tidsbudgeten tog slut under PR-listningen.`),
      });
    } catch (error) {
      core.warning(`${owner}/${repo}: kunde inte lista PR:er: ${error.message}`);
      continue;
    }

    for (const pull of pulls) {
      if (!isQualifiedPull(pull, { owner, repo, base, requireArmed: true })) continue;
      tasks.push({ repo, base, number: pull.number });
    }
  }

  if (tasks.length === 0) {
    core.info('Inga kvalificerade auto-merge-armerade PR:er hittades.');
    return;
  }

  let cursor = 0;
  let completed = 0;

  const maintainOne = async ({ repo, base, number }) => {
    try {
      if (now() >= deadline) return;

      let pull = (
        await github.rest.pulls.get({ owner, repo, pull_number: number })
      ).data;

      if (!isQualifiedPull(pull, { owner, repo, base, requireArmed: true })) {
        core.info(`${owner}/${repo}#${number}: kvalificerar inte längre för underhåll.`);
        return;
      }

      let [baseRef, headRef] = await Promise.all([
        github.rest.git.getRef({ owner, repo, ref: `heads/${base}` }),
        github.rest.git.getRef({ owner, repo, ref: `heads/${pull.head.ref}` }),
      ]);

      let comparison = await github.rest.repos.compareCommitsWithBasehead({
        owner,
        repo,
        basehead: `${baseRef.data.object.sha}...${headRef.data.object.sha}`,
      });

      if (comparison.data.behind_by === 0) {
        core.info(`${owner}/${repo}#${number}: redan aktuell och armerad.`);
        return;
      }

      core.info(
        `${owner}/${repo}#${number}: uppdaterar mot ${base} (behind_by=${comparison.data.behind_by}).`,
      );

      await github.rest.pulls.updateBranch({
        owner,
        repo,
        pull_number: number,
        expected_head_sha: pull.head.sha,
      });

      const pollDeadline = Math.min(deadline, now() + pollBudgetMs);
      let currentWithBase = false;

      while (now() < pollDeadline) {
        const waitMs = Math.min(pollIntervalMs, Math.max(0, pollDeadline - now()));
        if (waitMs > 0) await sleep(waitMs);
        if (now() >= deadline) break;

        [baseRef, headRef] = await Promise.all([
          github.rest.git.getRef({ owner, repo, ref: `heads/${base}` }),
          github.rest.git.getRef({ owner, repo, ref: `heads/${pull.head.ref}` }),
        ]);

        comparison = await github.rest.repos.compareCommitsWithBasehead({
          owner,
          repo,
          basehead: `${baseRef.data.object.sha}...${headRef.data.object.sha}`,
        });

        if (comparison.data.behind_by === 0) {
          currentWithBase = true;
          break;
        }
      }

      if (!currentWithBase) {
        const pollSeconds = Math.ceil(pollBudgetMs / 1000);
        const reason =
          now() >= deadline
            ? 'run-tidsbudgeten tog slut'
            : `${pollSeconds} sekunders polling tog slut`;
        core.warning(`${owner}/${repo}#${number}: blev inte aktuell; ${reason}.`);
        return;
      }

      pull = (
        await github.rest.pulls.get({ owner, repo, pull_number: number })
      ).data;

      if (!isQualifiedPull(pull, { owner, repo, base, requireArmed: false })) {
        core.info(`${owner}/${repo}#${number}: återarmeras inte eftersom PR:n inte längre kvalificerar.`);
        return;
      }

      if (pull.auto_merge != null) {
        core.info(`${owner}/${repo}#${number}: aktuell och fortsatt armerad.`);
        return;
      }

      core.info(`${owner}/${repo}#${number}: återarmerar native squash auto-merge efter verifierad branch-update.`);
      try {
        await github.graphql(
          `mutation($pullRequestId: ID!) {
            enablePullRequestAutoMerge(input: {
              pullRequestId: $pullRequestId,
              mergeMethod: SQUASH
            }) {
              pullRequest { number }
            }
          }`,
          { pullRequestId: pull.node_id },
        );
      } catch (error) {
        if (/already.*enabled|auto.?merge.*already/i.test(error.message)) {
          core.info(`${owner}/${repo}#${number}: auto-merge var redan återaktiverad.`);
        } else {
          core.warning(`${owner}/${repo}#${number}: kunde inte återarmera auto-merge: ${error.message}`);
        }
      }
    } catch (error) {
      core.warning(`${owner}/${repo}#${number}: underhåll misslyckades: ${error.message}`);
    }
  };

  const worker = async () => {
    while (now() < deadline) {
      const index = cursor;
      cursor += 1;
      if (index >= tasks.length) return;
      await maintainOne(tasks[index]);
      completed += 1;
    }
  };

  const workerCount = Math.min(Math.max(1, maxConcurrency), tasks.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  if (completed < tasks.length) {
    core.warning(
      `PR-maintainerns tidsbudget tog slut: ${completed}/${tasks.length} kvalificerade PR:er behandlades. Återstående tas vid nästa schemakörning.`,
    );
  }
}
