const { evaluateRemediationScope, parseAlertReference } = require('./remediation-scope.cjs');

async function run({ github, context, core }) {
  const org = context.repo.owner;
  const activeMarker = '<!-- skvallerbyttan-remediation -->';
  const connectorLogin = 'chatgpt-codex-connector[bot]';
  const triggerToken = process.env.CODEX_TRIGGER_TOKEN || '';
  const expectedTriggerLogin = (process.env.CODEX_TRIGGER_LOGIN || 'blixten85').trim();
  const runId = String(process.env.DISPATCH_RUN_ID || Date.now());
  const runAttempt = String(process.env.DISPATCH_RUN_ATTEMPT || '1');

  const priority = title => {
    if (/\[(CRITICAL|MALWARE)\]/i.test(title)) return 0;
    if (/\[HIGH\]/i.test(title)) return 1;
    if (/\[Secret scanning\]/i.test(title)) return 2;
    return 3;
  };

  async function userApi(path, init = {}) {
    if (!triggerToken) throw new Error('CODEX_TRIGGER_TOKEN saknas');
    const response = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${triggerToken}`,
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Avkroken-skvallerbyttan-codex-trigger',
        ...(init.headers || {}),
      },
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`user GitHub API ${response.status}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
  }

  async function remediationScope(owner, repo, issueNumber, files) {
    const issue = (await github.rest.issues.get({ owner, repo, issue_number: issueNumber })).data;
    const issueBody = issue.body || '';
    const reference = parseAlertReference(issueBody);
    if (!reference) {
      return evaluateRemediationScope({ issueBody, alert: {}, files });
    }

    try {
      let alert;
      let locations = [];
      if (reference.type === 'code-scanning') {
        alert = await userApi(`/repos/${owner}/${repo}/code-scanning/alerts/${reference.number}`);
      } else if (reference.type === 'dependabot') {
        alert = await userApi(`/repos/${owner}/${repo}/dependabot/alerts/${reference.number}`);
      } else if (reference.type === 'secret-scanning') {
        alert = await userApi(`/repos/${owner}/${repo}/secret-scanning/alerts/${reference.number}`);
        locations = await userApi(`/repos/${owner}/${repo}/secret-scanning/alerts/${reference.number}/locations?per_page=100`) || [];
      }
      return evaluateRemediationScope({ issueBody, alert: alert || {}, locations, files });
    } catch (error) {
      return {
        eligible: false,
        reason: 'alert-verification-failed',
        reference,
        expectedPaths: [],
        verificationError: String(error.message || error).slice(0, 500),
      };
    }
  }

  async function ensureComment(owner, repo, issueNumber, marker, body) {
    const comments = await github.paginate(github.rest.issues.listComments, {
      owner, repo, issue_number: issueNumber, per_page: 100,
    });
    if (comments.some(comment => (comment.body || '').includes(marker))) return;
    await github.rest.issues.createComment({
      owner,
      repo,
      issue_number: issueNumber,
      body: `${marker}\n${body}`,
    });
  }

  async function disableAutoMerge(pr) {
    if (!pr.auto_merge) return;
    try {
      await github.graphql(`
        mutation($pullRequestId: ID!) {
          disablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId }) {
            pullRequest { number }
          }
        }
      `, { pullRequestId: pr.node_id });
    } catch (error) {
      core.warning(`Kunde inte avaktivera auto-merge på #${pr.number}: ${error.message}`);
    }
  }

  async function keepDraft(pr) {
    await disableAutoMerge(pr);
    if (pr.draft) return;
    await github.graphql(`
      mutation($pullRequestId: ID!) {
        convertPullRequestToDraft(input: { pullRequestId: $pullRequestId }) {
          pullRequest { number isDraft }
        }
      }
    `, { pullRequestId: pr.node_id });
  }

  async function markReadyAndArm(owner, repo, pr, issueNumber) {
    if (pr.draft) {
      await github.graphql(`
        mutation($pullRequestId: ID!) {
          markPullRequestReadyForReview(input: { pullRequestId: $pullRequestId }) {
            pullRequest { number isDraft }
          }
        }
      `, { pullRequestId: pr.node_id });
    }

    const fresh = (await github.rest.pulls.get({ owner, repo, pull_number: pr.number })).data;
    if (fresh.auto_merge) return true;

    try {
      await github.graphql(`
        mutation($pullRequestId: ID!) {
          enablePullRequestAutoMerge(input: { pullRequestId: $pullRequestId, mergeMethod: SQUASH }) {
            pullRequest { number }
          }
        }
      `, { pullRequestId: fresh.node_id });
      return true;
    } catch (error) {
      const marker = `<!-- skvallerbyttan-auto-merge-blocked:${issueNumber} -->`;
      await ensureComment(
        owner,
        repo,
        pr.number,
        marker,
        `Seed-filen är borta och alert-relevant scope är verifierad, men GitHub nekade att armera auto-merge: ${String(error.message || error).slice(0, 500)}. Direkt merge används inte som fallback; PR:n lämnas öppen för normal repository-policy.`
      );
      core.warning(`${owner}/${repo}#${pr.number}: auto-merge kunde inte armeras: ${error.message}`);
      return false;
    }
  }

  async function codexAcknowledged(owner, repo, commentId) {
    const reactions = await github.request('GET /repos/{owner}/{repo}/issues/comments/{comment_id}/reactions', {
      owner,
      repo,
      comment_id: commentId,
      per_page: 100,
      headers: { accept: 'application/vnd.github+json' },
    });
    return reactions.data.some(reaction =>
      reaction.content === 'eyes' && reaction.user?.login === connectorLogin
    );
  }

  async function postCodexTrigger(owner, repo, pr, issueNumber, retry) {
    const marker = `<!-- skvallerbyttan-codex-trigger:${issueNumber} -->`;
    const body = [
      marker,
      `@codex implement security issue #${issueNumber} autonomously on this existing PR.`,
      '',
      'Requirements:',
      `- Read issue #${issueNumber} and verify the underlying security finding.`,
      '- Read and follow AGENTS.md and repository instructions before changing code.',
      '- Make the smallest safe fix without dismissing or changing the security alert state.',
      '- Work on this existing PR/branch; do not create another branch or PR.',
      `- Delete .github/codex-dispatch/issue-${issueNumber}.md before completion.`,
      '- Run relevant tests/typechecks and address every valid CI or review finding.',
      '- Re-read review summaries and unresolved inline threads after every push.',
      '- Do not bypass branch protection, required checks, or review-thread resolution.',
      retry ? '- This is an automatic retry because the previous Codex trigger was not acknowledged.' : '',
    ].filter(Boolean).join('\n');

    const comment = await userApi(`/repos/${owner}/${repo}/issues/${pr.number}/comments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body }),
    });
    const actualLogin = comment?.user?.login || '';
    if (actualLogin.toLowerCase() !== expectedTriggerLogin.toLowerCase()) {
      throw new Error(`CODEX_TRIGGER_TOKEN tillhör ${actualLogin || 'okänd användare'}, förväntade ${expectedTriggerLogin}`);
    }
    return comment;
  }

  let triggerIdentity = '';
  if (triggerToken) {
    const me = await userApi('/user');
    triggerIdentity = me?.login || '';
    if (triggerIdentity.toLowerCase() !== expectedTriggerLogin.toLowerCase()) {
      throw new Error(`CODEX_TRIGGER_TOKEN tillhör ${triggerIdentity || 'okänd användare'}, förväntade ${expectedTriggerLogin}`);
    }
    core.notice(`Codex-trigger credential verifierat för ${triggerIdentity}.`);
  } else {
    core.warning('CODEX_TRIGGER_TOKEN saknas. Ingen ny remediation-PR skapas; dispatch fail-closed.');
  }

  const repos = await github.paginate(github.rest.repos.listForOrg, {
    org, per_page: 100, type: 'all',
  });
  const activeRepos = repos.filter(repository => !repository.archived);
  const openPullsByRepo = new Map();

  for (const repository of activeRepos) {
    const owner = repository.owner.login;
    const repo = repository.name;
    const base = repository.default_branch || 'main';
    const pulls = await github.paginate(github.rest.pulls.list, {
      owner, repo, state: 'open', base, per_page: 100,
    });
    openPullsByRepo.set(repository.full_name, pulls);

    for (const pr of pulls.filter(candidate => (candidate.body || '').includes(activeMarker))) {
      const match = (pr.body || '').match(/skvallerbyttan-remediation-issue:(\d+)/);
      if (!match) {
        core.warning(`${repository.full_name}#${pr.number} saknar issue-marker; lämnas orörd.`);
        continue;
      }

      const issueNumber = Number(match[1]);
      const seedPath = `.github/codex-dispatch/issue-${issueNumber}.md`;
      const files = await github.paginate(github.rest.pulls.listFiles, {
        owner, repo, pull_number: pr.number, per_page: 100,
      });
      const seedPresent = files.some(file => file.filename === seedPath);
      const realFiles = files.filter(file => file.filename !== seedPath);

      if (seedPresent || realFiles.length === 0) {
        await keepDraft(pr);
        if (!triggerToken) {
          await ensureComment(
            owner,
            repo,
            pr.number,
            '<!-- skvallerbyttan-codex-dispatch:blocked-credential -->',
            'Automatisk Codex-delegering är pausad eftersom `CODEX_TRIGGER_TOKEN` saknas eller inte kan verifieras. PR:n hålls som draft och auto-merge är avstängd; seed-only får aldrig mergas.'
          );
          continue;
        }

        const marker = `<!-- skvallerbyttan-codex-trigger:${issueNumber} -->`;
        const comments = await github.paginate(github.rest.issues.listComments, {
          owner, repo, issue_number: pr.number, per_page: 100,
        });
        const triggers = comments.filter(comment =>
          comment.user?.login?.toLowerCase() === expectedTriggerLogin.toLowerCase() &&
          (comment.body || '').includes(marker) &&
          (comment.body || '').includes('@codex')
        );
        const last = triggers.at(-1);
        const acknowledged = last ? await codexAcknowledged(owner, repo, last.id) : false;
        const ageMs = last?.created_at ? Date.now() - Date.parse(last.created_at) : Number.POSITIVE_INFINITY;

        if (!acknowledged && (!last || ageMs >= 10 * 60 * 1000)) {
          await postCodexTrigger(owner, repo, pr, issueNumber, Boolean(last));
        }
        if (!acknowledged) {
          await ensureComment(
            owner,
            repo,
            pr.number,
            '<!-- skvallerbyttan-codex-dispatch:no-ack -->',
            'Codex-triggern har ännu inte kvitterats med 👀 av `chatgpt-codex-connector[bot]`. PR:n förblir draft och kan inte auto-merga.'
          );
        }
        continue;
      }

      const scope = await remediationScope(owner, repo, issueNumber, realFiles);
      if (!scope.eligible) {
        await keepDraft(pr);
        const expected = (scope.expectedPaths || []).slice(0, 8).map(path => `\`${path}\``).join(', ');
        const verification = scope.verificationError ? ` Verifieringsfel: ${scope.verificationError}` : '';
        await ensureComment(
          owner,
          repo,
          pr.number,
          `<!-- skvallerbyttan-remediation-scope-blocked:${issueNumber} -->`,
          `Auto-merge är avstängd eftersom PR:n inte har verifierad alert-relevant scope (${scope.reason}). ${expected ? `Förväntad path: ${expected}.` : 'Ingen verifierbar alert-path kunde fastställas.'}${verification} PR:n förblir draft för manuell eller fortsatt Codex-remediation.`
        );
        core.warning(`${repository.full_name}#${pr.number}: remediation scope blockerad (${scope.reason}).`);
        continue;
      }

      const armed = await markReadyAndArm(owner, repo, pr, issueNumber);
      if (armed) {
        await ensureComment(
          owner,
          repo,
          pr.number,
          `<!-- skvallerbyttan-codex-finalized:${issueNumber} -->`,
          `Seed-filen är borttagen och alert-relevant path \`${scope.matchedPath}\` är ändrad. PR:n är ready-for-review och squash auto-merge är armerad; ordinarie required CI och review-thread-resolution är fortsatt blockerande.`
        );
      }
    }
  }

  const search = await github.paginate(github.rest.search.issuesAndPullRequests, {
    q: `org:${org} is:issue is:open in:body "skvallerbyttan-alert:"`,
    sort: 'created',
    order: 'asc',
    per_page: 100,
  });
  const issues = search
    .filter(item => !item.pull_request)
    .sort((a, b) => priority(a.title || '') - priority(b.title || '') || a.number - b.number);
  const handledRepos = new Set();

  for (const issue of issues) {
    const repositoryUrl = issue.repository_url || '';
    const prefix = 'https://api.github.com/repos/';
    if (!repositoryUrl.startsWith(prefix)) continue;
    const fullName = repositoryUrl.slice(prefix.length);
    if (!fullName.toLowerCase().startsWith(`${org.toLowerCase()}/`)) continue;
    if (handledRepos.has(fullName)) continue;
    handledRepos.add(fullName);

    const repository = activeRepos.find(candidate => candidate.full_name === fullName);
    if (!repository) continue;
    const [owner, repo] = fullName.split('/');
    const issueNumber = issue.number;
    const base = repository.default_branch || 'main';
    const pulls = openPullsByRepo.get(fullName) || [];

    if (pulls.some(pr => (pr.body || '').includes(activeMarker))) {
      core.info(`${fullName} har redan en aktiv remediation; #${issueNumber} köas.`);
      continue;
    }

    if (!triggerToken) {
      await ensureComment(
        owner,
        repo,
        issueNumber,
        '<!-- skvallerbyttan-codex-dispatch:blocked-credential -->',
        'Automatisk Codex-remediation väntar. Skvallerbyttans `CODEX_TRIGGER_TOKEN` är inte konfigurerad eller verifierbar. Ingen branch eller seed-PR skapas förrän en giltig användarcredential finns.'
      );
      continue;
    }

    const baseRef = await github.rest.git.getRef({ owner, repo, ref: `heads/${base}` });
    const baseSha = baseRef.data.object.sha;
    const branch = `automation/codex-issue/${issueNumber}-${runId}-${runAttempt}`;
    const seedPath = `.github/codex-dispatch/issue-${issueNumber}.md`;
    const seed = [
      '# Codex remediation seed',
      '',
      `Temporary PR context for security issue #${issueNumber}.`,
      '',
      'Codex must implement and verify the real fix, then delete this file before completion.',
      '',
    ].join('\n');

    let createdRef = false;
    try {
      await github.rest.git.createRef({
        owner,
        repo,
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      });
      createdRef = true;

      await github.rest.repos.createOrUpdateFileContents({
        owner,
        repo,
        path: seedPath,
        message: `chore: seed Codex remediation for #${issueNumber}`,
        content: Buffer.from(seed).toString('base64'),
        branch,
      });

      const pr = await github.rest.pulls.create({
        owner,
        repo,
        head: branch,
        base,
        title: `fix(security): remediate issue #${issueNumber}`,
        body: [
          activeMarker,
          `<!-- skvallerbyttan-remediation-issue:${issueNumber} -->`,
          '',
          `Automatisk Codex-remediation för säkerhetsissue #${issueNumber}.`,
          '',
          `Seed-filen \`${seedPath}\` är tillfällig. PR:n hålls som draft och saknar auto-merge tills seed-filen är borttagen och verkliga ändringar finns.`,
          '',
          `Fixes #${issueNumber}`,
        ].join('\n'),
        draft: true,
        maintainer_can_modify: true,
      });

      const posted = await postCodexTrigger(owner, repo, pr.data, issueNumber, false);
      const acknowledged = await codexAcknowledged(owner, repo, posted.id);
      await ensureComment(
        owner,
        repo,
        issueNumber,
        `<!-- skvallerbyttan-codex-pr:${issueNumber} -->`,
        acknowledged
          ? `Codex-remediation har flyttats till PR-kontext: ${pr.data.html_url}. Codex kvitterade triggern; PR:n hålls draft tills seed-filen är ersatt av en verklig fix.`
          : `Codex-remediation har flyttats till PR-kontext: ${pr.data.html_url}. Triggern väntar på Codex-kvittens; PR:n förblir draft och kan inte auto-merga.`
      );
      core.notice(`Dispatchade ${fullName}#${issueNumber} till draft-PR #${pr.data.number} på ${branch}.`);
    } catch (error) {
      if (createdRef) {
        try {
          const open = await github.rest.pulls.list({
            owner, repo, state: 'open', head: `${owner}:${branch}`, per_page: 1,
          });
          if (open.data.length === 0) {
            await github.rest.git.deleteRef({ owner, repo, ref: `heads/${branch}` });
          }
        } catch (cleanupError) {
          core.warning(`Kunde inte städa branch ${fullName}:${branch}: ${cleanupError.message}`);
        }
      }
      throw error;
    }
  }
}

module.exports = { run };
