const view = {
  activeTab: "overview",
  overview: null,
  loaded: new Set(),
  activityDays: 30,
  activityProvider: "",
  requestControllers: new Map(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

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

function fmtDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("sv-SE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusKind(status) {
  if (status === "available" || status === "fresh") return "good";
  if (status === "stale" || status === "partial" || status === "not_observed" || status === "unknown") return "warn";
  if (status === "permission_denied" || status === "error") return "bad";
  return "neutral";
}

function statusBadge(status) {
  const value = status || "unknown";
  return `<span class="badge ${statusKind(value)}">${esc(value)}</span>`;
}

function kv(rows) {
  return `<div class="kv">${rows.map(([key, value]) =>
    `<div>${esc(key)}</div><div>${value}</div>`
  ).join("")}</div>`;
}

function list(items, empty = "Ingen data observerad.") {
  if (!items.length) return `<p class="small">${esc(empty)}</p>`;
  return `<ul class="list">${items.join("")}</ul>`;
}

async function api(path, key = path) {
  const previous = view.requestControllers.get(key);
  if (previous) previous.abort();
  const controller = new AbortController();
  view.requestControllers.set(key, controller);
  try {
    const response = await fetch(path, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    return await response.json();
  } finally {
    if (view.requestControllers.get(key) === controller) view.requestControllers.delete(key);
  }
}

function pathStatus(value) {
  if (!value || typeof value !== "object") return "unknown";
  return value.status || (value.available === true ? "available" : value.available === false ? "unavailable" : "unknown");
}

function hashTab() {
  const raw = location.hash.replace(/^#/, "");
  if (raw.startsWith("repo=")) return "overview";
  const params = new URLSearchParams(raw);
  const tab = params.get("tab");
  return ["overview", "github", "cloudflare", "activity", "insight"].includes(tab) ? tab : "overview";
}

function setTabHash(tab) {
  history.replaceState(null, "", `#tab=${encodeURIComponent(tab)}`);
}

function activateTab(tab, { focus = false, updateHash = true } = {}) {
  const safeTab = ["overview", "github", "cloudflare", "activity", "insight"].includes(tab) ? tab : "overview";
  view.activeTab = safeTab;

  for (const button of $$("[role=tab][data-tab]")) {
    const selected = button.dataset.tab === safeTab;
    button.classList.toggle("active", selected);
    button.setAttribute("aria-selected", String(selected));
    button.tabIndex = selected ? 0 : -1;
    if (selected && focus) button.focus();
  }

  for (const panel of $$("[data-tab-panel]")) {
    panel.hidden = panel.dataset.tabPanel !== safeTab;
  }

  if (updateHash && !location.hash.startsWith("#repo=")) setTabHash(safeTab);
  void ensureTabData(safeTab);
}

function setupTabs() {
  const tabs = $$("[role=tab][data-tab]");
  tabs.forEach((button, index) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
    button.addEventListener("keydown", (event) => {
      let next = null;
      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      if (event.key === "Home") next = 0;
      if (event.key === "End") next = tabs.length - 1;
      if (next === null) return;
      event.preventDefault();
      activateTab(tabs[next].dataset.tab, { focus: true });
    });
  });

  window.addEventListener("hashchange", () => activateTab(hashTab(), { updateHash: false }));
  activateTab(hashTab(), { updateHash: false });
}

async function loadProviderStrip() {
  const target = $("#provider-strip");
  if (!target) return;
  try {
    const [capabilities, activity] = await Promise.all([
      api("/api/v1/capabilities", "provider-strip-capabilities"),
      api("/api/v1/activity?days=1", "provider-strip-activity"),
    ]);
    const health = capabilities.providerHealth?.providers || {};
    const totals = {};
    for (const row of activity.grouped || []) {
      totals[row.provider] = (totals[row.provider] || 0) + Number(row.observedCount || 0);
    }
    target.innerHTML = ["github", "cloudflare"].map((provider) => {
      const providerHealth = health[provider] || {};
      const label = provider === "github" ? "GitHub" : "Cloudflare";
      return `<article class="provider-summary">
        <div><strong>${label}</strong> ${statusBadge(providerHealth.status || "unknown")}</div>
        <span>${fmtInt(totals[provider] || 0)} observerade events / 24 h</span>
      </article>`;
    }).join("");
  } catch (error) {
    target.innerHTML = `<p class="small">Provideröversikten kunde inte läsas: ${esc(error.message)}</p>`;
  }
}

function renderGitHubRepositories() {
  const target = $("#github-repo-rows");
  if (!target) return;
  const repositories = view.overview?.repositories || [];
  target.innerHTML = repositories.map((repo) => `
    <tr>
      <td>
        <button type="button" class="inline-button" data-effective-repo="${esc(repo.name)}">${esc(repo.name)}</button>
        <span class="repo-meta">${esc(repo.language || "—")}</span>
      </td>
      <td>${esc(repo.visibility || "—")}</td>
      <td>${repo.actions ? statusBadge(repo.actions.failedLast7d > 0 ? "error" : "available") : statusBadge("unknown")}</td>
      <td>${repo.security ? statusBadge("available") : statusBadge("unknown")}</td>
      <td>${esc(fmtDate(repo.pushedAt))}</td>
    </tr>
  `).join("") || '<tr><td colspan="5">Ingen repository-state laddad.</td></tr>';

  target.querySelectorAll("[data-effective-repo]").forEach((button) => {
    button.addEventListener("click", () => loadEffectivePolicy(button.dataset.effectiveRepo));
  });
}

async function loadEffectivePolicy(repo) {
  const target = $("#github-governance");
  if (!target || !repo) return;
  target.innerHTML = `<p class="loading">Laddar effective state för ${esc(repo)}…</p>`;
  try {
    const data = await api(
      `/api/v1/github/repos/${encodeURIComponent(repo)}/effective-policy`,
      "github-effective-policy",
    );
    const governance = data.effectiveGovernance || {};
    const rulesets = governance.rulesets || {};
    const properties = governance.customProperties || {};
    const security = governance.securityConfiguration || {};
    target.innerHTML = `
      <p><strong>${esc(repo)}</strong> · effective governance</p>
      ${kv([
        ["Rulesets", `${statusBadge(pathStatus(rulesets))} ${fmtInt((rulesets.effective || []).length)} effective · ${fmtInt((rulesets.inherited || []).length)} inherited · ${fmtInt((rulesets.direct || []).length)} direct`],
        ["Custom Properties", `${statusBadge(pathStatus(properties))} ${fmtInt((properties.value || []).length)} values`],
        ["Security configuration", statusBadge(pathStatus(security))],
        ["Actions permissions", statusBadge(pathStatus(governance.actions?.permissions))],
        ["Workflow Execution Protections", statusBadge(pathStatus(governance.actions?.workflowExecutionProtections))],
        ["Property → ruleset relation", statusBadge(pathStatus(governance.customPropertyRulesetRelations))],
      ])}
      ${list((rulesets.effective || []).map((rule) => {
        const source = rule.provenance?.inherited ? "inherited" : rule.provenance?.direct ? "direct" : "unknown";
        return `<li><strong>${esc(rule.name || "ruleset")}</strong> · ${esc(rule.enforcement || "—")} · ${esc(source)}</li>`;
      }), "Inga effective rulesets observerade.")}
    `;
  } catch (error) {
    target.innerHTML = `<p class="error-text">Effective state kunde inte läsas: ${esc(error.message)}</p>`;
  }
}

function renderGitHubOrg(data) {
  const actions = data.actions || {};
  const custom = data.customProperties || {};
  const security = data.securityConfigurations || {};
  const definitions = custom.definitions?.value || [];
  const assignments = custom.assignments?.value || [];
  const configurations = security.configurations?.value || [];

  $("#github-status").className = "status-callout";
  $("#github-status").innerHTML = `Canonical org-state · schema v${esc(data.schemaVersion || 1)} · genererad ${esc(fmtDate(data.generatedAt))}`;
  $("#github-cards").innerHTML = [
    ["Repos", view.overview?.repositoryCount ?? "—", "GitHub App inventory"],
    ["Custom Properties", definitions.length, pathStatus(custom.definitions)],
    ["Security configs", configurations.length, pathStatus(security.configurations)],
    ["Property assignments", assignments.length, pathStatus(custom.assignments)],
  ].map(([label, value, hint]) =>
    `<article class="card"><p class="label">${esc(label)}</p><span class="value">${esc(value)}</span><span class="hint">${esc(hint)}</span></article>`
  ).join("");

  $("#github-governance").innerHTML = `
    ${kv([
      ["Actions permissions", statusBadge(pathStatus(actions.permissions))],
      ["Allowed Actions", statusBadge(pathStatus(actions.selectedActions))],
      ["Workflow permissions", statusBadge(pathStatus(actions.workflowPermissions))],
      ["Workflow Execution Protections", statusBadge(pathStatus(actions.policies))],
      ["Organization rulesets", statusBadge(pathStatus(data.rulesets))],
      ["Custom Properties", statusBadge(pathStatus(custom.definitions))],
      ["Security configurations", statusBadge(pathStatus(security.configurations))],
    ])}
    <p class="small">Klicka på ett repository i inventoryn för dess effective state.</p>
  `;

  $("#github-permissions").innerHTML = `
    ${kv([
      ["Actions policy GET", esc(actions.policies?.permissionState || "unknown")],
      ["Org ruleset GET", esc(data.rulesets?.permissionState || "unknown")],
      ["Custom Properties", esc(pathStatus(custom.definitions))],
      ["Security configs", esc(pathStatus(security.configurations))],
    ])}
    <p class="small">Write-klassade providerpermissions begärs inte för read-only observation.</p>
  `;
  renderGitHubRepositories();
}

async function loadGitHub(force = false) {
  if (view.loaded.has("github") && !force) {
    renderGitHubRepositories();
    return;
  }
  $("#github-status").className = "status-callout loading";
  $("#github-status").textContent = "Laddar GitHub-state…";
  try {
    const data = await api("/api/v1/github/org/state", "github-org-state");
    renderGitHubOrg(data);
    view.loaded.add("github");
  } catch (error) {
    $("#github-status").className = "status-callout error";
    $("#github-status").textContent = `GitHub-state kunde inte läsas: ${error.message}`;
  }
}

function renderCloudflareAccount(data) {
  if (data.available === false) return `<p>${statusBadge(data.status)} <span class="small">${esc(data.reason || "")}</span></p>`;
  return kv([
    ["Name", esc(data.name || "—")],
    ["Type", esc(data.type || "—")],
    ["Created", esc(fmtDate(data.createdOn))],
  ]);
}

function renderCloudflareWorkers(data) {
  if (data.available === false) return `<p>${statusBadge(data.status)} <span class="small">${esc(data.reason || "")}</span></p>`;
  return list((data.items || []).map((worker) =>
    `<li><strong>${esc(worker.id || "worker")}</strong><br><span class="small">compat ${esc(worker.compatibilityDate || "—")} · ändrad ${esc(fmtDate(worker.modifiedOn))}</span></li>`
  ), "Inga Workers observerade.");
}

function renderCloudflareZones(data) {
  if (data.available === false) return `<p>${statusBadge(data.status)} <span class="small">${esc(data.reason || "")}</span></p>`;
  return list((data.items || []).map((zone) =>
    `<li><strong>${esc(zone.name || zone.id || "zone")}</strong> · ${statusBadge(zone.status === "active" ? "available" : zone.status || "unknown")}<br><span class="small">${esc(zone.plan || "—")} · ${esc(zone.type || "—")}</span></li>`
  ), "Inga zones observerade.");
}

function renderCloudflareStorage(d1, kvStorage, r2) {
  return kv([
    ["D1 databases", `${statusBadge(pathStatus(d1))} ${d1.available === false ? "—" : fmtInt(d1.count)}`],
    ["KV namespaces", `${statusBadge(pathStatus(kvStorage))} ${kvStorage.available === false ? "—" : fmtInt(kvStorage.count)}`],
    ["R2 buckets", `${statusBadge(pathStatus(r2))} ${r2.available === false ? "—" : fmtInt(r2.count)}`],
  ]);
}

function renderCloudflareZeroTrust(access, tunnels) {
  return `
    ${kv([
      ["Access applications", `${statusBadge(pathStatus(access))} ${access.available === false ? "—" : fmtInt(access.count)}`],
      ["Tunnels", `${statusBadge(pathStatus(tunnels))} ${tunnels.available === false ? "—" : fmtInt(tunnels.count)}`],
    ])}
    ${list((tunnels.items || []).slice(0, 12).map((tunnel) =>
      `<li><strong>${esc(tunnel.name || tunnel.id || "tunnel")}</strong> · ${statusBadge(tunnel.status || "unknown")}<br><span class="small">${esc(tunnel.type || "—")} · ${esc(tunnel.configSource || "—")}</span></li>`
    ), "Inga tunnels observerade.")}
  `;
}

function renderCloudflareAudit(data) {
  if (data.available === false) return `<p>${statusBadge(data.status)} <span class="small">${esc(data.reason || "")}</span></p>`;
  const coverage = data.coverage || {};
  return `
    <p class="small">Coverage: ${statusBadge(coverage.coverage || "unknown")} · periodComplete: ${esc(String(coverage.periodComplete ?? false))} · ${esc(coverage.sampling || "unknown")}</p>
    ${list((data.items || []).slice(0, 30).map((item) => `
      <li>
        <strong>${esc(item.action?.description || item.action?.type || "Audit event")}</strong>
        · ${esc(item.action?.result || "—")}
        <br><span class="small">${esc(item.resource?.product || item.resource?.type || "resource")} · ${esc(item.resource?.id || "—")} · ${esc(fmtDate(item.occurredAt))}</span>
      </li>
    `), "Inga Audit Logs observerade i perioden.")}
  `;
}

async function loadCloudflare(force = false) {
  if (view.loaded.has("cloudflare") && !force) return;
  $("#cloudflare-status").className = "status-callout loading";
  $("#cloudflare-status").textContent = "Laddar Cloudflare-state…";
  try {
    const [account, zones, workers, d1, kvStorage, r2, access, tunnels, audit] = await Promise.all([
      api("/api/v1/cloudflare/account", "cf-account"),
      api("/api/v1/cloudflare/zones", "cf-zones"),
      api("/api/v1/cloudflare/workers", "cf-workers"),
      api("/api/v1/cloudflare/storage/d1", "cf-storage-d1"),
      api("/api/v1/cloudflare/storage/kv", "cf-storage-kv"),
      api("/api/v1/cloudflare/storage/r2", "cf-storage-r2"),
      api("/api/v1/cloudflare/zero-trust/access", "cf-zero-trust-access"),
      api("/api/v1/cloudflare/zero-trust/tunnels", "cf-zero-trust-tunnels"),
      api("/api/v1/cloudflare/audit?days=7", "cf-audit"),
    ]);
    $("#cloudflare-account").innerHTML = renderCloudflareAccount(account);
    $("#cloudflare-workers").innerHTML = renderCloudflareWorkers(workers);
    $("#cloudflare-zones").innerHTML = renderCloudflareZones(zones);
    $("#cloudflare-storage").innerHTML = renderCloudflareStorage(d1, kvStorage, r2);
    $("#cloudflare-zero-trust").innerHTML = renderCloudflareZeroTrust(access, tunnels);
    $("#cloudflare-audit").innerHTML = renderCloudflareAudit(audit);
    $("#cloudflare-cards").innerHTML = [
      ["Account", account.available === false ? "—" : 1, pathStatus(account)],
      ["Zones", zones.available === false ? "—" : zones.count, pathStatus(zones)],
      ["Workers", workers.available === false ? "—" : workers.count, pathStatus(workers)],
      ["Storage", [d1, kvStorage, r2].filter((item) => item.available !== false).reduce((sum, item) => sum + Number(item.count || 0), 0), [d1, kvStorage, r2].some((item) => item.available === false) ? "partial" : "available"],
      ["Zero Trust", [access, tunnels].filter((item) => item.available !== false).reduce((sum, item) => sum + Number(item.count || 0), 0), [access, tunnels].some((item) => item.available === false) ? "partial" : "available"],
      ["Audit sample", audit.available === false ? "—" : audit.count, audit.coverage?.coverage || pathStatus(audit)],
    ].map(([label, value, hint]) =>
      `<article class="card"><p class="label">${esc(label)}</p><span class="value">${esc(value)}</span><span class="hint">${esc(hint)}</span></article>`
    ).join("");
    const unavailable = [account, zones, workers, d1, kvStorage, r2, access, tunnels, audit]
      .filter((item) => item.available === false).length;
    $("#cloudflare-status").className = "status-callout";
    $("#cloudflare-status").innerHTML = unavailable
      ? `${statusBadge("partial")} ${unavailable} capability-källor är inte tillgängliga.`
      : `${statusBadge("available")} Canonical Cloudflare-state laddad.`;
    view.loaded.add("cloudflare");
  } catch (error) {
    $("#cloudflare-status").className = "status-callout error";
    $("#cloudflare-status").textContent = `Cloudflare-state kunde inte läsas: ${error.message}`;
  }
}

function capabilityLabel(key) {
  return String(key || "")
    .replace(/^github\.avkroken\./, "GitHub · ")
    .replace(/^cloudflare\.avkroken\./, "Cloudflare · ")
    .replaceAll("_", " ");
}

function renderActivity(data) {
  const status = $("#activity-status");
  if (data.available === false) {
    status.className = "status-callout error";
    status.innerHTML = `${statusBadge(data.status)} ${esc(data.reason || "Aktivitetsdata saknas.")}`;
    $("#activity-ranking").innerHTML = "";
    $("#activity-coverage").innerHTML = "";
    $("#activity-stream").innerHTML = "";
    return;
  }

  status.className = "status-callout";
  status.innerHTML = `${statusBadge("available")} Observerad period ${esc(fmtDate(data.period?.from))} – ${esc(fmtDate(data.period?.to))}`;

  const totals = new Map();
  for (const row of data.grouped || []) {
    totals.set(row.capability, (totals.get(row.capability) || 0) + Number(row.observedCount || 0));
  }
  const ranking = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...ranking.map(([, count]) => count));
  $("#activity-ranking").innerHTML = ranking.map(([capability, count]) => `
    <button type="button" class="activity-row" data-capability="${esc(capability)}">
      <span>${esc(capabilityLabel(capability))}</span>
      <span class="activity-bar"><span class="activity-level-${Math.max(1, Math.min(10, Math.ceil((count / max) * 10)))}"></span></span>
      <strong>${fmtInt(count)}</strong>
    </button>
  `).join("") || '<p class="small">Ingen aktivitet observerad i perioden.</p>';

  $("#activity-ranking").querySelectorAll("[data-capability]").forEach((button) => {
    button.addEventListener("click", () => loadActivity(false, button.dataset.capability));
  });

  $("#activity-coverage").innerHTML = list((data.coverage || []).map((item) => `
    <li><strong>${esc(capabilityLabel(item.capability))}</strong><br>
      <span class="small">${esc(item.source)} · ${esc(item.coverage)} · first ${esc(fmtDate(item.firstObservedAt))} · periodComplete ${esc(String(item.periodComplete))}</span>
    </li>
  `), "Ingen observationsgrad registrerad.");

  $("#activity-stream").innerHTML = list((data.recent || []).map((item) => `
    <li><strong>${esc(capabilityLabel(item.capability))}</strong> · ${esc(item.event)}${item.action ? ` · ${esc(item.action)}` : ""}
      <br><span class="small">${esc(item.provider)} · ${esc(item.source)} · ${esc(item.coverage)} · ${esc(item.repository || item.resourceId || "—")} · ${esc(fmtDate(item.occurredAt || item.receivedAt))}</span>
    </li>
  `), "Inga events observerade.");
}

async function loadActivity(force = false, capability = "") {
  if (view.loaded.has("activity") && !force && !capability) return;
  $("#activity-status").className = "status-callout loading";
  $("#activity-status").textContent = "Laddar aktivitet…";
  const params = new URLSearchParams({ days: String(view.activityDays) });
  if (view.activityProvider) params.set("provider", view.activityProvider);
  if (capability) params.set("capability", capability);
  try {
    const data = await api(`/api/v1/activity?${params}`, "activity");
    renderActivity(data);
    view.loaded.add("activity");
  } catch (error) {
    $("#activity-status").className = "status-callout error";
    $("#activity-status").textContent = `Aktivitet kunde inte läsas: ${error.message}`;
  }
}

function aggregateReads(rows) {
  const byCapability = new Map();
  const byConsumer = new Map();
  for (const row of rows || []) {
    const count = Number(row.reads || 0);
    byCapability.set(row.capability, (byCapability.get(row.capability) || 0) + count);
    byConsumer.set(row.consumer, (byConsumer.get(row.consumer) || 0) + count);
  }
  return { byCapability, byConsumer };
}

function renderProviderHealth(health) {
  const providers = health?.providers || {};
  $("#provider-health").innerHTML = ["github", "cloudflare"].map((provider) => {
    const item = providers[provider] || {};
    const budget = item.budget || {};
    return `<article class="health-row">
      <div><strong>${provider === "github" ? "GitHub" : "Cloudflare"}</strong> ${statusBadge(item.status || "unknown")}</div>
      <div class="health-details">
        <span>Auth: ${item.auth?.configured ? "configured" : "not_configured"}</span>
        <span>Last status: ${esc(item.auth?.lastStatus ?? "—")}</span>
        <span>Remaining: ${esc(budget.remaining ?? "—")}</span>
        <span>Reset: ${esc(fmtDate(budget.resetAt))}</span>
        <span>Throttled: ${esc(String(budget.throttled ?? false))}</span>
      </div>
    </article>`;
  }).join("");
}

function renderCapabilities(caps, activity, reads) {
  const activityByCap = new Map();
  for (const row of activity?.grouped || []) {
    activityByCap.set(row.capability, (activityByCap.get(row.capability) || 0) + Number(row.observedCount || 0));
  }
  const { byCapability } = aggregateReads(reads?.rows || []);

  $("#capability-cards").innerHTML = (caps.capabilities || []).map((cap) => `
    <article class="capability-card">
      <div class="capability-head">
        <div><p class="eyebrow">${esc(cap.provider)} · ${esc(cap.scope)}</p><h3>${esc(cap.name)}</h3></div>
        ${statusBadge(cap.status)}
      </div>
      ${kv([
        ["Permission", esc(cap.permissionState || "unknown")],
        ["Provider support", esc(cap.providerSupport || "unknown")],
        ["Data", esc(cap.dataState || "unknown")],
        ["Freshness", esc(cap.freshness || "unknown")],
        ["Activity 30d", fmtInt(activityByCap.get(cap.key) || 0)],
        ["Reads 30d", fmtInt(byCapability.get(cap.key) || 0)],
        ["Cache TTL", cap.cacheTtlMs ? `${fmtInt(Math.round(cap.cacheTtlMs / 60000))} min` : "—"],
        ["Last success", esc(fmtDate(cap.lastSuccessAt))],
      ])}
      <details>
        <summary>Detaljer</summary>
        <p class="small"><code>${esc(cap.key)}</code></p>
        <p class="small">${esc(cap.endpoint || "")}</p>
        <p class="small">Permission: ${esc(cap.permission || "—")}</p>
        ${cap.lastError ? `<p class="small error-text">${esc(cap.lastError)}</p>` : ""}
      </details>
    </article>
  `).join("");
}

function renderReads(reads) {
  if (!reads?.available) {
    $("#read-metrics").innerHTML = `<p>${statusBadge(reads?.status || "unknown")} <span class="small">${esc(reads?.reason || "Read telemetry är inte tillgänglig.")}</span></p>`;
    return;
  }
  const { byConsumer } = aggregateReads(reads.rows || []);
  const rows = [...byConsumer.entries()].sort((a, b) => b[1] - a[1]);
  $("#read-metrics").innerHTML = `
    <div class="cards compact">
      ${rows.map(([consumer, count]) =>
        `<article class="card"><p class="label">${esc(consumer)}</p><span class="value">${fmtInt(count)}</span><span class="hint">reads / ${esc(reads.days || 30)}d</span></article>`
      ).join("")}
    </div>
    ${list((reads.rows || []).slice(0, 30).map((row) =>
      `<li><strong>${esc(capabilityLabel(row.capability))}</strong> · ${esc(row.consumer)} · ${fmtInt(row.reads)} reads · <span class="small">${esc(row.cache)} · avg ${esc(Math.round(Number(row.avg_duration_ms || 0)))} ms</span></li>`
    ), "Ingen read telemetry registrerad.")}
  `;
}

async function loadInsight(force = false) {
  if (view.loaded.has("insight") && !force) return;
  $("#insight-status").className = "status-callout loading";
  $("#insight-status").textContent = "Laddar capability-registret…";
  try {
    const [capabilities, activity, reads] = await Promise.all([
      api("/api/v1/capabilities", "insight-capabilities"),
      api("/api/v1/activity?days=30", "insight-activity"),
      api("/api/v1/reads?days=30", "insight-reads"),
    ]);
    renderProviderHealth(capabilities.providerHealth);
    renderCapabilities(capabilities, activity, reads);
    renderReads(reads);
    const statuses = (capabilities.capabilities || []).reduce((map, cap) => {
      map[cap.status] = (map[cap.status] || 0) + 1;
      return map;
    }, {});
    $("#insight-status").className = "status-callout";
    $("#insight-status").innerHTML = `Schema v${esc(capabilities.schemaVersion || 1)} · ${fmtInt(capabilities.capabilities?.length || 0)} capabilities · ${Object.entries(statuses).map(([key, count]) => `${esc(key)} ${fmtInt(count)}`).join(" · ")}`;
    view.loaded.add("insight");
  } catch (error) {
    $("#insight-status").className = "status-callout error";
    $("#insight-status").textContent = `Insyn kunde inte läsas: ${error.message}`;
  }
}

async function ensureTabData(tab) {
  if (tab === "github") return loadGitHub();
  if (tab === "cloudflare") return loadCloudflare();
  if (tab === "activity") return loadActivity();
  if (tab === "insight") return loadInsight();
}

export function setOverviewForObservations(data) {
  view.overview = data;
  renderGitHubRepositories();
  if (!view.loaded.has("provider-strip")) {
    view.loaded.add("provider-strip");
    void loadProviderStrip();
  }
}

export function refreshActiveObservationTab(force = true) {
  if (view.activeTab === "github") return loadGitHub(force);
  if (view.activeTab === "cloudflare") return loadCloudflare(force);
  if (view.activeTab === "activity") return loadActivity(force);
  if (view.activeTab === "insight") return loadInsight(force);
}

export function initObservationsNavigation() {
  setupTabs();

  $$(".activity-range").forEach((button) => {
    button.addEventListener("click", () => {
      view.activityDays = Number(button.dataset.days || 30);
      $$(".activity-range").forEach((item) => item.classList.toggle("active", item === button));
      void loadActivity(true);
    });
  });

  $("#activity-provider")?.addEventListener("change", (event) => {
    view.activityProvider = event.currentTarget.value;
    void loadActivity(true);
  });
}
