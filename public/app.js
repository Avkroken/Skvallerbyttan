const state = { overview: null };
const $ = (selector) => document.querySelector(selector);

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function fmtInt(value) {
  return new Intl.NumberFormat("sv-SE").format(Number(value ?? 0));
}

function fmtPct(value) {
  if (value == null || Number.isNaN(Number(value))) return "—";
  return new Intl.NumberFormat("sv-SE", { style: "percent", maximumFractionDigits: 1 }).format(value);
}

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function age(value) {
  if (!value) return "—";
  const ms = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(ms)) return "—";
  const days = Math.floor(ms / 86_400_000);
  if (days < 1) return "idag";
  if (days === 1) return "1 dag";
  return `${days} dagar`;
}

function badge(text, kind = "neutral") {
  return `<span class="badge ${kind}">${esc(text)}</span>`;
}

async function api(path) {
  const response = await fetch(path, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
  return response.json();
}

function card(label, value, hint = "") {
  return `<article class="card"><p class="label">${esc(label)}</p><span class="value">${esc(value)}</span><span class="hint">${esc(hint)}</span></article>`;
}

function renderCards(data) {
  const critical = (data.security?.codeScanning?.severities?.critical ?? 0) + (data.security?.dependabot?.severities?.critical ?? 0);
  const high = (data.security?.codeScanning?.severities?.high ?? 0) + (data.security?.dependabot?.severities?.high ?? 0);
  const secret = data.security?.secretScanning?.count ?? 0;
  $("#cards").innerHTML = [
    card("Öppna secrets", fmtInt(secret), "Secret scanning"),
    card("Critical / high", `${fmtInt(critical)} / ${fmtInt(high)}`, "CodeQL + Dependabot"),
    card("CI pass rate", fmtPct(data.totals.actionSamplePassRate), "Senaste 100 runs per repo"),
    card("Misslyckade runs", fmtInt(data.totals.failedRunsLast7dSample), "7 dagar, inom samples"),
    card("Öppna / stale PR", `${fmtInt(data.totals.openPullRequests)} / ${fmtInt(data.totals.stalePullRequests)}`, "Stale = 14 dagar"),
    card("Repos / Actions", `${fmtInt(data.repositoryCount)} / ${fmtInt(data.totals.actionRuns)}`, "Installerad GitHub App"),
  ].join("");
}

function securityText(repo) {
  const sec = repo.security || {};
  const critical = (sec.codeScanningSeverity?.critical ?? 0) + (sec.dependabotSeverity?.critical ?? 0);
  const high = (sec.codeScanningSeverity?.high ?? 0) + (sec.dependabotSeverity?.high ?? 0);
  const secret = sec.secretScanning ?? 0;
  if (secret > 0 || critical > 0) return badge(`S ${secret} · C ${critical} · H ${high}`, "bad");
  if (high > 0 || (sec.dependabot ?? 0) > 0 || (sec.codeScanning ?? 0) > 0) return badge(`S ${secret} · C ${critical} · H ${high}`, "warn");
  return badge("inga öppna", "good");
}

function actionText(actions) {
  if (!actions) return badge("otillgängligt", "neutral");
  const rate = fmtPct(actions.passRate);
  if (actions.failedLast7d > 0) return badge(`${rate} · ${actions.failedLast7d} fel/7d`, "bad");
  return badge(rate, "good");
}

function renderRepoRows(data) {
  $("#repo-rows").innerHTML = data.repositories.map((repo) => `
    <tr data-repo="${esc(repo.name)}" tabindex="0" role="button" aria-label="Visa detaljer för ${esc(repo.name)}">
      <td><span class="repo-name">${esc(repo.name)}</span><span class="repo-meta">${esc(repo.language || "—")} · ${esc(repo.visibility)}</span></td>
      <td>${fmtInt(repo.attentionScore)}</td>
      <td>${securityText(repo)}</td>
      <td>${actionText(repo.actions)}</td>
      <td>${repo.openPullRequests == null ? "—" : `${fmtInt(repo.openPullRequests)} / ${fmtInt(repo.stalePullRequests)} stale`}</td>
      <td>${fmtInt(repo.openIssues)}</td>
      <td title="${esc(fmtDate(repo.pushedAt))}">${esc(age(repo.pushedAt))}</td>
    </tr>`).join("");

  document.querySelectorAll("#repo-rows tr").forEach((row) => {
    const open = () => loadRepo(row.dataset.repo);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      open();
    });
  });
}

function renderCapabilities(data, target = "#capabilities") {
  const node = $(target);
  if (!node) return;
  node.innerHTML = (data.capabilities || []).map((cap) =>
    `<span class="capability ${cap.available ? "" : "off"}" title="HTTP ${esc(cap.status)}${cap.reason ? ` · ${esc(cap.reason)}` : ""}">${esc(cap.key)} · ${cap.available ? "OK" : "saknas"}</span>`
  ).join("");
}

function spark(values = []) {
  const max = Math.max(1, ...values);
  return `<div class="spark" aria-label="52 veckors aktivitet">${values.map((value) => {
    const level = Math.max(1, Math.min(10, Math.ceil((value / max) * 10)));
    return `<span class="spark-${level}" title="${esc(value)} commits"></span>`;
  }).join("")}</div>`;
}

function kv(rows) {
  return `<div class="kv">${rows.map(([key, value]) => `<div>${esc(key)}</div><div>${value}</div>`).join("")}</div>`;
}

function renderRepoDetail(data) {
  const repo = data.repository;
  $("#repo-title").textContent = repo.fullName;
  const code = data.security.codeScanning;
  const dep = data.security.dependabot;
  const secret = data.security.secretScanning;
  const views = data.traffic.views;
  const clones = data.traffic.clones;
  const participation = data.activity.participation?.all || [];
  const languages = data.code.languages || {};
  const languageTotal = Object.values(languages).reduce((sum, value) => sum + value, 0);

  const runs = data.actions.recentRuns || [];
  const pulls = data.pullRequests.open || [];
  const contributors = data.activity.contributors || [];
  const releases = data.activity.releases || [];

  $("#repo-detail-content").innerHTML = `
    <div class="detail-grid">
      <article class="panel">
        <h3>Repository</h3>
        ${kv([
          ["Visibility", esc(repo.visibility)],
          ["Default branch", esc(repo.defaultBranch || "—")],
          ["Stars / forks", `${fmtInt(repo.stars)} / ${fmtInt(repo.forks)}`],
          ["Open issues", fmtInt(repo.openIssues)],
          ["Open PR", repo.openPullRequests == null ? "—" : fmtInt(repo.openPullRequests)],
          ["Senast push", esc(fmtDate(repo.pushedAt))],
        ])}
      </article>

      <article class="panel">
        <h3>Säkerhet</h3>
        ${kv([
          ["Code scanning", code ? fmtInt(code.count) : "—"],
          ["Dependabot", dep ? fmtInt(dep.count) : "—"],
          ["Secret scanning", secret ? fmtInt(secret.count) : "—"],
          ["Critical", fmtInt((code?.severities?.critical ?? 0) + (dep?.severities?.critical ?? 0))],
          ["High", fmtInt((code?.severities?.high ?? 0) + (dep?.severities?.high ?? 0))],
        ])}
      </article>

      <article class="panel">
        <h3>Traffic · 14 dagar</h3>
        ${kv([
          ["Views", views ? `${fmtInt(views.count)} (${fmtInt(views.uniques)} unika)` : "—"],
          ["Clones", clones ? `${fmtInt(clones.count)} (${fmtInt(clones.uniques)} unika)` : "—"],
          ["Contributors", fmtInt(contributors.length)],
          ["Releases", fmtInt(releases.length)],
        ])}
      </article>

      <article class="panel wide">
        <h3>Actions</h3>
        ${data.actions.summary ? kv([
          ["Totalt antal runs", fmtInt(data.actions.summary.totalRuns)],
          ["Sample", fmtInt(data.actions.summary.sampledRuns)],
          ["Pass rate", fmtPct(data.actions.summary.passRate)],
          ["Fel senaste 7 dagar", fmtInt(data.actions.summary.failedLast7d)],
          ["Workflows", data.actions.workflowCount == null ? "—" : fmtInt(data.actions.workflowCount)],
        ]) : '<p class="error-text">Actions-data är inte tillgänglig för GitHub Appen.</p>'}
        <ul class="list">${runs.slice(0, 10).map((run) => `<li><a href="${esc(run.url || "#")}" target="_blank" rel="noreferrer"><strong>${esc(run.name || "Workflow")}</strong> · ${esc(run.event || "—")} · ${badge(run.conclusion || run.status || "—", run.conclusion === "success" ? "good" : run.conclusion === "failure" ? "bad" : "neutral")}<br><span class="small">${esc(run.actor || "—")} · ${esc(fmtDate(run.createdAt))}</span></a></li>`).join("") || '<li class="small">Inga runs i sample.</li>'}</ul>
      </article>

      <article class="panel">
        <h3>Commit-aktivitet · 52 veckor</h3>
        ${participation.length ? spark(participation) : '<p class="small">Ingen participation-data.</p>'}
      </article>

      <article class="panel full">
        <h3>Öppna pull requests</h3>
        <div class="table-wrap">
          <table class="mini-table">
            <thead><tr><th>#</th><th>Titel</th><th>Författare</th><th>Uppdaterad</th><th>Draft</th></tr></thead>
            <tbody>${pulls.map((pr) => `<tr><td>${fmtInt(pr.number)}</td><td><a href="${esc(pr.url || "#")}" target="_blank" rel="noreferrer">${esc(pr.title || "—")}</a></td><td>${esc(pr.author || "—")}</td><td>${esc(age(pr.updatedAt))}</td><td>${pr.draft ? "ja" : "nej"}</td></tr>`).join("") || '<tr><td colspan="5">Inga öppna PR.</td></tr>'}</tbody>
          </table>
        </div>
      </article>

      <article class="panel">
        <h3>Språk</h3>
        ${languageTotal ? kv(Object.entries(languages).sort((a,b) => b[1]-a[1]).slice(0,8).map(([name, bytes]) => [name, fmtPct(bytes/languageTotal)])) : '<p class="small">Ingen språkdata.</p>'}
      </article>

      <article class="panel">
        <h3>Top contributors</h3>
        <ul class="list">${contributors.slice(0, 10).map((person) => `<li><a href="${esc(person.url || "#")}" target="_blank" rel="noreferrer">${esc(person.login || "—")}</a> <span class="small">${fmtInt(person.contributions)} commits</span></li>`).join("") || '<li class="small">Ingen contributor-data.</li>'}</ul>
      </article>

      <article class="panel">
        <h3>Rulesets / branches</h3>
        ${kv([
          ["Rulesets", fmtInt((data.code.rulesets || []).length)],
          ["Branches i sample", fmtInt((data.code.branches || []).length)],
          ["Deployments i sample", fmtInt((data.activity.deployments || []).length)],
        ])}
        <ul class="list">${(data.code.rulesets || []).slice(0, 8).map((rule) => `<li>${esc(rule.name || "ruleset")} <span class="small">${esc(rule.enforcement || "—")} · ${esc(rule.source_type || "—")}</span></li>`).join("")}</ul>
      </article>

      <article class="panel full">
        <h3>Repo-API-kapabiliteter</h3>
        <div id="repo-capabilities" class="capabilities"></div>
      </article>
    </div>`;
  renderCapabilities(data, "#repo-capabilities");
}

async function loadRepo(name) {
  if (!name) return;
  const detail = $("#repo-detail");
  const content = $("#repo-detail-content");
  detail.classList.remove("hidden");
  content.innerHTML = '<p class="loading">Laddar repo-data…</p>';
  detail.scrollIntoView({ behavior: "smooth", block: "start" });
  try {
    const data = await api(`/api/repos/${encodeURIComponent(name)}`);
    renderRepoDetail(data);
    history.replaceState(null, "", `#repo=${encodeURIComponent(name)}`);
  } catch (error) {
    content.innerHTML = `<p class="error-text">Kunde inte läsa repo-data: ${esc(error.message)}</p>`;
  }
}

async function loadOverview(refresh = false) {
  $("#alert").classList.add("hidden");
  try {
    const data = await api(`/api/overview${refresh ? "?refresh=1" : ""}`);
    state.overview = data;
    renderCards(data);
    renderRepoRows(data);
    renderCapabilities(data);
    $("#freshness").textContent = `Genererad ${fmtDate(data.generatedAt)}`;

    const repoHash = location.hash.match(/^#repo=(.+)$/)?.[1];
    if (repoHash) loadRepo(decodeURIComponent(repoHash));
  } catch (error) {
    const alert = $("#alert");
    alert.textContent = `Dashboarden kunde inte läsa GitHub-data: ${error.message}`;
    alert.classList.remove("hidden");
    $("#freshness").textContent = "Data saknas";
  }
}

$("#refresh").addEventListener("click", () => loadOverview(true));
$("#close-detail").addEventListener("click", () => {
  $("#repo-detail").classList.add("hidden");
  history.replaceState(null, "", location.pathname);
});

loadOverview();
