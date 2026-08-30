import { DurableObject } from "cloudflare:workers";
import { ExpiringValueCache } from "./expiring-value-cache";
import { MalwareAlertCache } from "./malware-alert-cache";
import { alertApiPath, alertIsRemediated, alertReference, assignmentAllowed, needsAssignee, reconciledIssueState, type AlertReference } from "./reconciliation";

interface Env {
  SKVALLERBYTTAN_WEBHOOK_SECRET: string;
  SKVALLERBYTTAN_CLIENT_ID: string;
  SKVALLERBYTTAN_APP_PRIVATE_KEY: string;
  SKVALLERBYTTAN_EMAIL_TO: string;
  SKVALLERBYTTAN_EMAIL_FROM: string;
  EMAIL: SendEmail;
  SKVALLERBYTTAN_ISSUE_LOCK: DurableObjectNamespace<SkvallerbyttanIssueLock>;
}

type IssueSpec = { marker: string; title: string; body: string };
type BackfillStats = { scanned: number; eligible: number; created: number; exists: number; errors: number };
type SecurityIssue = { assignees?: Array<{ login?: string }>; body?: string; number: number; repository_url: string; state?: string; title?: string };

const ORG = "Avkroken";
const API_VERSION = "2022-11-28";
const ISSUE_SEVERITIES = new Set(["medium", "high", "critical"]);
const SUPPORTED_EVENTS = new Set(["code_scanning_alert", "dependabot_alert", "secret_scanning_alert"]);
const SECURITY_ISSUE_ASSIGNEE = "blixten85";
const ASSIGNMENT_PAUSED_REPOS = new Set(["avkroken/produkter"]);
const installationTokenCache = new ExpiringValueCache<string>();

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function base64url(input: string | ArrayBuffer): string {
  const bytes = typeof input === "string" ? new TextEncoder().encode(input) : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function der(tag: number, value: Uint8Array): Uint8Array {
  const length = derLength(value.length);
  return Uint8Array.from([tag, ...length, ...value]);
}

function pemPkcs8Bytes(pem: string): ArrayBuffer {
  const pkcs1 = pem.includes("-----BEGIN RSA PRIVATE KEY-----");
  const body = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g, "");
  if (!body) throw new Error("GitHub App private key PEM is empty or invalid");
  const binary = atob(body);
  const keyBytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  if (!pkcs1) return keyBytes.slice().buffer;

  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaEncryptionAlgorithm = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  return der(0x30, Uint8Array.from([
    ...version,
    ...rsaEncryptionAlgorithm,
    ...der(0x04, keyBytes),
  ])).slice().buffer;
}

function configured(env: Env): boolean {
  return Boolean(env.SKVALLERBYTTAN_WEBHOOK_SECRET && env.SKVALLERBYTTAN_CLIENT_ID && env.SKVALLERBYTTAN_APP_PRIVATE_KEY);
}

async function verifySignature(raw: string, signature: string | null, secret: string): Promise<boolean> {
  if (!secret || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  return safeEqual(signature, `sha256=${hex(digest)}`);
}

async function appJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: now - 60, exp: now + 540, iss: env.SKVALLERBYTTAN_CLIENT_ID }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey("pkcs8", pemPkcs8Bytes(env.SKVALLERBYTTAN_APP_PRIVATE_KEY), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  return `${unsigned}.${base64url(signature)}`;
}

async function verifyGitHubAppIdentity(jwt: string, expectedClientId: string): Promise<void> {
  const response = await fetch("https://api.github.com/app", {
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": API_VERSION, "User-Agent": "Avkroken-skvallerbyttan" },
  });
  if (!response.ok) throw new Error(`GitHub app identity ${response.status}: ${(await response.text()).slice(0, 500)}`);
  const app = await response.json<{ id?: number; slug?: string; client_id?: string }>();
  if (app.client_id && app.client_id !== expectedClientId) {
    throw new Error(`GitHub app identity client id mismatch: expected ${expectedClientId}, got ${app.client_id}`);
  }
  console.log("skvallerbyttan GitHub App authenticated", {
    slug: app.slug ?? null,
    appId: app.id ?? null,
    clientId: app.client_id ?? null,
  });
}

async function installationToken(env: Env): Promise<string> {
  return installationTokenCache.get(async () => {
    const jwt = await appJwt(env);
    await verifyGitHubAppIdentity(jwt, env.SKVALLERBYTTAN_CLIENT_ID);
    const installationResponse = await fetch(`https://api.github.com/orgs/${encodeURIComponent(ORG)}/installation`, {
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": API_VERSION, "User-Agent": "Avkroken-skvallerbyttan" },
    });
    if (!installationResponse.ok) throw new Error(`GitHub installation lookup ${installationResponse.status}: ${(await installationResponse.text()).slice(0, 500)}`);
    const installation = await installationResponse.json<{ id?: number }>();
    if (!Number.isSafeInteger(installation.id) || Number(installation.id) <= 0) throw new Error("GitHub installation id missing");

    const response = await fetch(`https://api.github.com/app/installations/${installation.id}/access_tokens`, {
      method: "POST",
      headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${jwt}`, "X-GitHub-Api-Version": API_VERSION, "User-Agent": "Avkroken-skvallerbyttan" },
    });
    if (!response.ok) throw new Error(`GitHub installation token ${response.status}: ${(await response.text()).slice(0, 500)}`);
    const data = await response.json<{ token?: string; expires_at?: string }>();
    if (!data.token) throw new Error("GitHub installation token missing");
    const expiresAt = Date.parse(data.expires_at ?? "");
    if (!Number.isFinite(expiresAt)) throw new Error("GitHub installation token expiry missing");
    return { value: data.token, expiresAt };
  });
}

async function github(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": API_VERSION, "User-Agent": "Avkroken-skvallerbyttan", ...(init.headers ?? {}) },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${(await response.text()).slice(0, 500)}`);
  return response;
}

async function listAll<T>(token: string, initialPath: string): Promise<T[]> {
  const all: T[] = [];
  let path: string | null = initialPath;
  while (path) {
    const response = await github(token, path);
    all.push(...await response.json<T[]>());
    const next = (response.headers.get("link") ?? "").split(",").find((part) => part.includes('rel="next"'));
    const match = next?.match(/<https:\/\/api\.github\.com([^>]+)>/);
    path = match?.[1] ?? null;
  }
  return all;
}

async function issueExists(token: string, repo: string, marker: string): Promise<boolean> {
  const query = `repo:${repo} \"${marker}\" in:body`;
  const data = await (await github(token, `/search/issues?q=${encodeURIComponent(query)}&per_page=1`)).json<{ total_count?: number }>();
  return (data.total_count ?? 0) > 0;
}

async function createIssueUnlocked(token: string, repo: string, issue: IssueSpec): Promise<"created" | "exists"> {
  if (await issueExists(token, repo, issue.marker)) return "exists";
  const assignees = assignmentAllowed(repo, ASSIGNMENT_PAUSED_REPOS) ? [SECURITY_ISSUE_ASSIGNEE] : [];
  await github(token, `/repos/${repo}/issues`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: issue.title,
      body: `<!-- ${issue.marker} -->\n${issue.body}`,
      assignees,
    }),
  });
  return "created";
}

export class SkvallerbyttanIssueLock extends DurableObject<Env> {
  private tail: Promise<void> = Promise.resolve();

  async createIssue(token: string, repo: string, issue: IssueSpec): Promise<"created" | "exists"> {
    const previous = this.tail;
    let release = (): void => {};
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await createIssueUnlocked(token, repo, issue);
    } finally {
      release();
    }
  }
}

async function createIssue(env: Env, token: string, repo: string, issue: IssueSpec): Promise<"created" | "exists"> {
  const lock = env.SKVALLERBYTTAN_ISSUE_LOCK.getByName(`${repo}:${issue.marker}`);
  return lock.createIssue(token, repo, issue);
}

function repoFromApiUrl(repositoryUrl: string): string {
  const prefix = "https://api.github.com/repos/";
  return repositoryUrl.startsWith(prefix) ? repositoryUrl.slice(prefix.length) : "";
}

async function closeRemediatedIssue(token: string, repo: string, issueNumber: number, alert: AlertReference, state: string): Promise<void> {
  const marker = `skvallerbyttan-reconciled:${alert.type}:${alert.number}:${state}`;
  await github(token, `/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      body: `<!-- ${marker} -->\nSkvallerbyttan verifierade via GitHub API att säkerhetsalerten nu har state \`${state}\` och stänger därför issuet som slutfört.`,
    }),
  });
  await github(token, `/repos/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "closed", state_reason: "completed" }),
  });
}

async function reopenUnremediatedIssue(token: string, repo: string, issueNumber: number, alert: AlertReference): Promise<void> {
  await github(token, `/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      body: `<!-- skvallerbyttan-reopened:${alert.type}:${alert.number} -->\nSkvallerbyttan verifierade via GitHub API att säkerhetsalerten fortfarande har state \`open\` och återöppnar därför issuet.`,
    }),
  });
  await github(token, `/repos/${repo}/issues/${issueNumber}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ state: "open" }),
  });
}

async function ensureSecurityIssueAssignee(token: string, repo: string, issue: SecurityIssue): Promise<boolean> {
  if (!assignmentAllowed(repo, ASSIGNMENT_PAUSED_REPOS) || issue.state !== "open" || !needsAssignee(issue.assignees ?? [], SECURITY_ISSUE_ASSIGNEE)) return false;
  await github(token, `/repos/${repo}/issues/${issue.number}/assignees`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ assignees: [SECURITY_ISSUE_ASSIGNEE] }),
  });
  return true;
}

async function reconcileIssue(token: string, issue: SecurityIssue): Promise<"closed" | "reopened" | "synced" | "ignored"> {
  const repo = repoFromApiUrl(issue.repository_url);
  const alert = alertReference(issue.body ?? "");
  if (!validOrgRepo(repo) || !alert) return "ignored";
  const data = await (await github(token, alertApiPath(repo, alert))).json<{ state?: string }>();
  const state = String(data.state ?? "").toLowerCase();
  const desiredState = reconciledIssueState(alert, state);
  if (desiredState === "closed") {
    if (issue.state === "closed") return "synced";
    await closeRemediatedIssue(token, repo, issue.number, alert, state);
    return "closed";
  }
  if (desiredState === "open" && issue.state === "closed") {
    await reopenUnremediatedIssue(token, repo, issue.number, alert);
    return "reopened";
  }
  return "synced";
}

async function findSecurityIssues(token: string): Promise<SecurityIssue[]> {
  const issues: SecurityIssue[] = [];
  for (let page = 1; page <= 10; page += 1) {
    const query = `org:${ORG} is:issue in:body "skvallerbyttan-alert:"`;
    const data = await (await github(token, `/search/issues?q=${encodeURIComponent(query)}&sort=created&order=asc&per_page=100&page=${page}`)).json<{ items?: SecurityIssue[] }>();
    const batch = data.items ?? [];
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}

async function runIssueReconciliation(token: string): Promise<void> {
  const issues = await findSecurityIssues(token);
  const stats = { candidates: issues.length, assigned: 0, closed: 0, reopened: 0, synced: 0, ignored: 0, errors: 0 };
  for (const issue of issues) {
    try {
      const repo = repoFromApiUrl(issue.repository_url);
      const result = await reconcileIssue(token, issue);
      stats[result] += 1;
      const currentIssue = result === "reopened" ? { ...issue, state: "open" } : issue;
      if (result !== "closed" && validOrgRepo(repo) && await ensureSecurityIssueAssignee(token, repo, currentIssue)) stats.assigned += 1;
    } catch (error) {
      stats.errors += 1;
      console.error("skvallerbyttan issue reconciliation failed", {
        issueNumber: issue.number,
        repo: repoFromApiUrl(issue.repository_url),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  console.log("skvallerbyttan issue reconciliation complete", stats);
}

async function loadMalwareAlertNumbers(token: string, repo: string): Promise<readonly number[]> {
  const alerts = await listAll<{ number: number }>(token, `/repos/${repo}/dependabot/alerts?state=open&classification=malware&per_page=100`);
  return alerts.map((alert) => alert.number);
}

async function isMalware(token: string, repo: string, alertNumber: number, cache?: MalwareAlertCache): Promise<boolean> {
  if (cache) return cache.has(repo, alertNumber);
  return (await loadMalwareAlertNumbers(token, repo)).includes(alertNumber);
}

function codeScanningIssue(alert: any): IssueSpec | null {
  if (alert.state !== "open" || !Number.isSafeInteger(alert.number)) return null;
  const severity = String(alert.rule?.security_severity_level ?? "").toLowerCase();
  if (!ISSUE_SEVERITIES.has(severity)) return null;
  const rule = alert.rule?.name ?? alert.rule?.id ?? "Code scanning alert";
  return {
    marker: `skvallerbyttan-alert:code-scanning:${alert.number}`,
    title: `[Security][Code scanning][${severity.toUpperCase()}] ${rule}`,
    body: `Automatiskt skapat från ett öppet GitHub Code Scanning-alert.\n\n- **Severity:** ${severity.toUpperCase()}\n- **Rule:** ${rule}\n- **Alert:** ${alert.html_url ?? ""}`,
  };
}

async function dependabotIssue(token: string, repo: string, alert: any, malwareCache?: MalwareAlertCache): Promise<IssueSpec | null> {
  if (alert.state !== "open" || !Number.isSafeInteger(alert.number)) return null;
  const malware = await isMalware(token, repo, alert.number, malwareCache);
  const severity = String(alert.security_advisory?.severity ?? alert.security_vulnerability?.severity ?? "unknown").toLowerCase();
  if (!malware && !ISSUE_SEVERITIES.has(severity)) return null;
  const level = malware ? "MALWARE" : severity.toUpperCase();
  const pkg = alert.dependency?.package?.name ?? "unknown package";
  const summary = alert.security_advisory?.summary ?? (malware ? "Malicious dependency detected" : "Dependabot alert");
  return {
    marker: `skvallerbyttan-alert:dependabot:${alert.number}`,
    title: `[Security][Dependabot][${level}] ${pkg}: ${summary}`,
    body: `Automatiskt skapat från ett öppet GitHub Dependabot-alert. Malware inkluderas alltid; övriga alerts kräver Medium eller högre.\n\n- **Severity/class:** ${level}\n- **Package:** ${pkg}\n- **Summary:** ${summary}\n- **Alert:** ${alert.html_url ?? ""}`,
  };
}

function secretScanningIssue(alert: any): IssueSpec | null {
  if (alert.state !== "open" || !Number.isSafeInteger(alert.number)) return null;
  const secretType = alert.secret_type_display_name ?? alert.secret_type ?? "Secret detected";
  return {
    marker: `skvallerbyttan-alert:secret-scanning:${alert.number}`,
    title: `[Security][Secret scanning] ${secretType}`,
    body: `Automatiskt skapat från ett öppet GitHub Secret Scanning-alert. Själva hemligheten inkluderas avsiktligt inte i issuet.\n\n- **Type:** ${secretType}\n- **Validity:** ${alert.validity ?? "unknown"}\n- **Alert:** ${alert.html_url ?? ""}`,
  };
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

async function sendSecretScanningEmail(
  env: Env,
  repo: string,
  alert: any,
  action: string,
  delivery: string,
): Promise<void> {
  const alertNumber = Number.isSafeInteger(alert.number) ? alert.number : "unknown";
  const secretType = String(alert.secret_type_display_name ?? alert.secret_type ?? "Secret detected");
  const validity = String(alert.validity ?? "unknown");
  const alertUrl = String(alert.html_url ?? "");
  const subject = `[Security][Secret scanning] ${repo} #${alertNumber}: ${secretType}`;
  const text = [
    `GitHub Secret Scanning reported a ${action} alert.`,
    "",
    `Repository: ${repo}`,
    `Alert: #${alertNumber}`,
    `Type: ${secretType}`,
    `Validity: ${validity}`,
    `URL: ${alertUrl}`,
    "",
    "The detected secret is intentionally not included in this email.",
  ].join("\n");
  const html = `<p>GitHub Secret Scanning reported a <strong>${escapeHtml(action)}</strong> alert.</p>
<ul>
  <li><strong>Repository:</strong> ${escapeHtml(repo)}</li>
  <li><strong>Alert:</strong> #${escapeHtml(String(alertNumber))}</li>
  <li><strong>Type:</strong> ${escapeHtml(secretType)}</li>
  <li><strong>Validity:</strong> ${escapeHtml(validity)}</li>
  <li><strong>URL:</strong> <a href="${escapeHtml(alertUrl)}">${escapeHtml(alertUrl)}</a></li>
</ul>
<p>The detected secret is intentionally not included in this email.</p>`;

  await env.EMAIL.send({
    to: env.SKVALLERBYTTAN_EMAIL_TO,
    from: { email: env.SKVALLERBYTTAN_EMAIL_FROM, name: "Avkroken Skvallerbyttan" },
    subject,
    text,
    html,
  });
  console.log("skvallerbyttan secret alert email sent", { delivery, action, repo, alertNumber });
}

function repoFromAlert(alert: any): string {
  return String(alert.repository?.full_name ?? "");
}

function validOrgRepo(repo: string): boolean {
  return repo.toLowerCase().startsWith(`${ORG.toLowerCase()}/`);
}

async function backfillType(
  env: Env,
  token: string,
  type: string,
  path: string,
  makeIssue: (repo: string, alert: any) => Promise<IssueSpec | null>,
): Promise<BackfillStats> {
  const stats: BackfillStats = { scanned: 0, eligible: 0, created: 0, exists: 0, errors: 0 };
  const alerts = await listAll<any>(token, path);
  stats.scanned = alerts.length;

  for (const alert of alerts) {
    const repo = repoFromAlert(alert);
    if (!validOrgRepo(repo)) continue;
    try {
      const issue = await makeIssue(repo, alert);
      if (!issue) continue;
      stats.eligible += 1;
      const result = await createIssue(env, token, repo, issue);
      stats[result] += 1;
    } catch (error) {
      stats.errors += 1;
      console.error("skvallerbyttan backfill alert failed", { type, repo, alertNumber: alert.number ?? null, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return stats;
}

async function runBackfill(env: Env): Promise<void> {
  if (!configured(env)) throw new Error("Skvallerbyttan Worker is not configured");
  const token = await installationToken(env);
  const code = await backfillType(
    env,
    token,
    "code_scanning",
    `/orgs/${encodeURIComponent(ORG)}/code-scanning/alerts?state=open&per_page=100`,
    async (_repo, alert) => codeScanningIssue(alert),
  );
  const malwareCache = new MalwareAlertCache((repo) => loadMalwareAlertNumbers(token, repo));
  const dependabot = await backfillType(
    env,
    token,
    "dependabot",
    `/orgs/${encodeURIComponent(ORG)}/dependabot/alerts?state=open&per_page=100`,
    async (repo, alert) => dependabotIssue(token, repo, alert, malwareCache),
  );
  const secret = await backfillType(
    env,
    token,
    "secret_scanning",
    `/orgs/${encodeURIComponent(ORG)}/secret-scanning/alerts?state=open&per_page=100`,
    async (_repo, alert) => secretScanningIssue(alert),
  );
  console.log("skvallerbyttan backfill complete", { code, dependabot, secret });
  await runIssueReconciliation(token);
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const path = new URL(req.url).pathname;
    if (req.method === "GET" && (path === "/" || path === "/health")) return Response.json({ ok: true, service: "skvallerbyttan" });
    if (req.method !== "POST" || path !== "/webhook") return new Response("Not found", { status: 404 });
    if (!configured(env)) {
      console.error("skvallerbyttan webhook not configured");
      return new Response("Not configured", { status: 503 });
    }

    const raw = await req.text();
    const delivery = req.headers.get("x-github-delivery") ?? "";
    const event = req.headers.get("x-github-event") ?? "";

    if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256"), env.SKVALLERBYTTAN_WEBHOOK_SECRET))) {
      console.warn("skvallerbyttan webhook bad signature", { delivery, event });
      return new Response("Bad signature", { status: 401 });
    }

    if (event === "ping") {
      console.log("skvallerbyttan webhook ping", { delivery });
      ctx.waitUntil(runBackfill(env).catch((error) => console.error("skvallerbyttan ping backfill failed", error instanceof Error ? error.message : String(error))));
      return new Response("pong\n");
    }

    let payload: any;
    try {
      payload = JSON.parse(raw);
    } catch {
      console.warn("skvallerbyttan webhook bad json", { delivery, event });
      return new Response("Bad JSON", { status: 400 });
    }

    const repo = String(payload.repository?.full_name ?? "");
    const action = String(payload.action ?? "");
    console.log("skvallerbyttan webhook received", { delivery, event, action, repo });

    if (!SUPPORTED_EVENTS.has(event)) {
      console.log("skvallerbyttan webhook ignored unsupported event", { delivery, event, action, repo });
      return new Response("ignored\n", { status: 202 });
    }
    if (!validOrgRepo(repo)) return new Response("Wrong organization", { status: 403 });

    const alert = payload.alert ?? {};
    if (event === "secret_scanning_alert" && (action === "created" || action === "reopened")) {
      ctx.waitUntil(sendSecretScanningEmail(env, repo, alert, action, delivery).catch((error) => {
        console.error("skvallerbyttan secret alert email failed", {
          delivery,
          action,
          repo,
          alertNumber: alert.number ?? null,
          error: error instanceof Error ? error.message : String(error),
        });
      }));
    }

    try {
      const token = await installationToken(env);
      const webhookAlert = alertReference(`skvallerbyttan-alert:${event.replaceAll("_alert", "").replaceAll("_", "-")}:${alert.number}`);
      const webhookState = String(alert.state ?? (event === "secret_scanning_alert" && action === "resolved" ? "resolved" : "")).toLowerCase();
      if (webhookAlert && alertIsRemediated(webhookAlert, webhookState)) {
        const query = `repo:${repo} is:issue is:open in:body "skvallerbyttan-alert:${webhookAlert.type}:${webhookAlert.number}"`;
        const data = await (await github(token, `/search/issues?q=${encodeURIComponent(query)}&per_page=1`)).json<{ items?: SecurityIssue[] }>();
        const issueToClose = data.items?.[0];
        if (issueToClose) await closeRemediatedIssue(token, repo, issueToClose.number, webhookAlert, webhookState);
        console.log("skvallerbyttan webhook reconciliation result", { delivery, event, action, repo, alertNumber: alert.number ?? null, result: issueToClose ? "closed" : "missing" });
        return new Response(`${issueToClose ? "closed" : "missing"}\n`);
      }
      const issue = event === "code_scanning_alert"
        ? codeScanningIssue(alert)
        : event === "dependabot_alert"
          ? await dependabotIssue(token, repo, alert)
          : (action === "created" || action === "reopened") ? secretScanningIssue({ ...alert, state: "open" }) : null;

      if (!issue) {
        console.log("skvallerbyttan webhook ignored alert", { delivery, event, action, repo, alertNumber: alert.number ?? null });
        return new Response("ignored\n", { status: 202 });
      }

      const result = await createIssue(env, token, repo, issue);
      console.log("skvallerbyttan webhook issue result", { delivery, event, action, repo, alertNumber: alert.number ?? null, result });
      return new Response(`${result}\n`, { status: result === "created" ? 201 : 200 });
    } catch (error) {
      console.error("skvallerbyttan webhook failed", { delivery, event, action, repo, error: error instanceof Error ? error.message : String(error) });
      return new Response("Upstream error", { status: 502 });
    }
  },

  async scheduled(event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runBackfill(env).catch((error) => console.error("skvallerbyttan scheduled automation failed", { cron: event.cron, error: error instanceof Error ? error.message : String(error) })));
  },
} satisfies ExportedHandler<Env>;
