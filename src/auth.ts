import type { Env } from "./env";

const CALLBACK_URL = "https://skvallerbyttan.denied.se/auth/github/callback";
const GITHUB_API_VERSION = "2026-03-10";
const USER_AGENT = "Avkroken-Skvallerbyttan-auth";
const OAUTH_COOKIE = "__Host-skvallerbyttan_oauth";
const SESSION_COOKIE = "__Host-skvallerbyttan_session";
const OAUTH_TTL_SECONDS = 10 * 60;
const SESSION_TTL_SECONDS = 12 * 60 * 60;

interface SessionPayload {
  v: 1;
  uid: number;
  iat: number;
  exp: number;
}

interface GitHubUser {
  id?: number;
  login?: string;
}

function base64url(input: string | ArrayBuffer | Uint8Array): string {
  const bytes = typeof input === "string"
    ? new TextEncoder().encode(input)
    : input instanceof Uint8Array
      ? input
      : new Uint8Array(input);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function decodeBase64url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function randomBase64url(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return base64url(bytes);
}

function cookie(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    if (trimmed.startsWith(`${name}=`)) return trimmed.slice(name.length + 1);
  }
  return null;
}

function safeEqual(left: string, right: string): boolean {
  const leftBytes = new TextEncoder().encode(left);
  const rightBytes = new TextEncoder().encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let diff = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < length; index += 1) {
    diff |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return diff === 0;
}

function secureCookie(name: string, value: string, maxAge: number): string {
  return `${name}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearCookie(name: string): string {
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function redirect(location: string, cookies: string[] = []): Response {
  const headers = new Headers({
    Location: location,
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  for (const value of cookies) headers.append("Set-Cookie", value);
  return new Response(null, { status: 303, headers });
}

function allowedIds(env: Env): Set<number> {
  const values = (env.SKVALLERBYTTAN_ALLOWED_GITHUB_IDS ?? "")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isSafeInteger(value) && value > 0);
  return new Set(values);
}

export function authConfigured(env: Env): boolean {
  return Boolean(
    env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID?.trim() &&
    env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET &&
    env.SKVALLERBYTTAN_SESSION_SECRET &&
    allowedIds(env).size > 0,
  );
}

async function sha256(value: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
}

async function sessionKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function createSession(env: Env, userId: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = {
    v: 1,
    uid: userId,
    iat: now,
    exp: now + SESSION_TTL_SECONDS,
  };
  const encoded = base64url(JSON.stringify(payload));
  const signature = await crypto.subtle.sign(
    "HMAC",
    await sessionKey(env.SKVALLERBYTTAN_SESSION_SECRET),
    new TextEncoder().encode(encoded),
  );
  return `${encoded}.${base64url(signature)}`;
}

export async function authenticatedUserId(request: Request, env: Env): Promise<number | null> {
  const value = cookie(request, SESSION_COOKIE);
  if (!value || !env.SKVALLERBYTTAN_SESSION_SECRET) return null;
  const separator = value.lastIndexOf(".");
  if (separator <= 0 || separator === value.length - 1) return null;

  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  let signatureBytes: Uint8Array;
  let payload: SessionPayload;
  try {
    signatureBytes = decodeBase64url(signature);
    payload = JSON.parse(new TextDecoder().decode(decodeBase64url(encoded))) as SessionPayload;
  } catch {
    return null;
  }

  const validSignature = await crypto.subtle.verify(
    "HMAC",
    await sessionKey(env.SKVALLERBYTTAN_SESSION_SECRET),
    signatureBytes,
    new TextEncoder().encode(encoded),
  );
  if (!validSignature) return null;

  const now = Math.floor(Date.now() / 1000);
  if (
    payload.v !== 1 ||
    !Number.isSafeInteger(payload.uid) ||
    payload.uid <= 0 ||
    !Number.isSafeInteger(payload.iat) ||
    !Number.isSafeInteger(payload.exp) ||
    payload.iat > now + 60 ||
    payload.exp <= now ||
    payload.exp - payload.iat > SESSION_TTL_SECONDS
  ) {
    return null;
  }

  return allowedIds(env).has(payload.uid) ? payload.uid : null;
}

export async function startGitHubLogin(env: Env): Promise<Response> {
  if (!authConfigured(env)) return redirect("/login?error=config");

  const state = randomBase64url(24);
  const verifier = randomBase64url(32);
  const challenge = base64url(await sha256(verifier));
  const authorize = new URL("https://github.com/login/oauth/authorize");
  authorize.searchParams.set("client_id", env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID);
  authorize.searchParams.set("redirect_uri", CALLBACK_URL);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", "read:user");
  authorize.searchParams.set("allow_signup", "false");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("code_challenge_method", "S256");

  return redirect(
    authorize.toString(),
    [secureCookie(OAUTH_COOKIE, `${state}.${verifier}`, OAUTH_TTL_SECONDS)],
  );
}

async function exchangeCode(env: Env, code: string, verifier: string): Promise<string> {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": USER_AGENT,
    },
    body: new URLSearchParams({
      client_id: env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID,
      client_secret: env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET,
      code,
      redirect_uri: CALLBACK_URL,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) throw new Error(`GitHub OAuth token exchange failed with ${response.status}`);
  const data = await response.json<{ access_token?: string; error?: string }>();
  if (!data.access_token || data.error) throw new Error("GitHub OAuth token exchange returned no access token");
  return data.access_token;
}

async function fetchGitHubUser(accessToken: string): Promise<GitHubUser> {
  const response = await fetch("https://api.github.com/user", {
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${accessToken}`,
      "X-GitHub-Api-Version": GITHUB_API_VERSION,
      "User-Agent": USER_AGENT,
    },
  });
  if (!response.ok) throw new Error(`GitHub user lookup failed with ${response.status}`);
  return response.json<GitHubUser>();
}

async function revokeGitHubToken(env: Env, accessToken: string): Promise<void> {
  const credentials = btoa(`${env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID}:${env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET}`);
  try {
    await fetch(
      `https://api.github.com/applications/${encodeURIComponent(env.SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID)}/token`,
      {
        method: "DELETE",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": GITHUB_API_VERSION,
          "User-Agent": USER_AGENT,
        },
        body: JSON.stringify({ access_token: accessToken }),
      },
    );
  } catch {
    // Tokenen används bara för identitetsuppslag och lagras aldrig. Ett misslyckat
    // revoke-anrop får därför inte bryta en i övrigt lyckad inloggning.
  }
}

export async function handleGitHubCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!authConfigured(env)) return redirect("/login?error=config", [clearCookie(OAUTH_COOKIE)]);
  if (url.searchParams.has("error")) return redirect("/login?error=oauth", [clearCookie(OAUTH_COOKIE)]);

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const stored = cookie(request, OAUTH_COOKIE);
  if (!code || !state || !stored) return redirect("/login?error=state", [clearCookie(OAUTH_COOKIE)]);

  const separator = stored.indexOf(".");
  if (separator <= 0 || separator === stored.length - 1) {
    return redirect("/login?error=state", [clearCookie(OAUTH_COOKIE)]);
  }
  const expectedState = stored.slice(0, separator);
  const verifier = stored.slice(separator + 1);
  if (!safeEqual(state, expectedState)) return redirect("/login?error=state", [clearCookie(OAUTH_COOKIE)]);

  let accessToken: string | null = null;
  try {
    accessToken = await exchangeCode(env, code, verifier);
    const user = await fetchGitHubUser(accessToken);
    if (!Number.isSafeInteger(user.id) || Number(user.id) <= 0) throw new Error("GitHub user id missing");
    const userId = Number(user.id);
    if (!allowedIds(env).has(userId)) {
      return redirect("/login?error=forbidden", [clearCookie(OAUTH_COOKIE), clearCookie(SESSION_COOKIE)]);
    }

    const session = await createSession(env, userId);
    return redirect("/", [
      clearCookie(OAUTH_COOKIE),
      secureCookie(SESSION_COOKIE, session, SESSION_TTL_SECONDS),
    ]);
  } catch (error) {
    console.error("github oauth callback failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return redirect("/login?error=oauth", [clearCookie(OAUTH_COOKIE), clearCookie(SESSION_COOKIE)]);
  } finally {
    if (accessToken) await revokeGitHubToken(env, accessToken);
  }
}

export function logout(): Response {
  return redirect("/login", [clearCookie(OAUTH_COOKIE), clearCookie(SESSION_COOKIE)]);
}

export function loginPage(request: Request, ready: boolean): Response {
  const error = new URL(request.url).searchParams.get("error");
  const errorText = error === "forbidden"
    ? "Det GitHub-kontot har inte åtkomst till Skvallerbyttan."
    : error === "state"
      ? "Inloggningen kunde inte verifieras. Försök igen."
      : error === "config"
        ? "GitHub-inloggningen är inte färdigkonfigurerad."
        : error === "oauth"
          ? "GitHub-inloggningen misslyckades. Försök igen."
          : "";
  const button = ready
    ? '<a class="login-button" href="/auth/github">Logga in med GitHub</a>'
    : '<span class="login-button disabled" aria-disabled="true">Logga in med GitHub</span>';
  const alert = errorText ? `<p class="login-alert" role="alert">${errorText}</p>` : "";

  const html = `<!doctype html>
<html lang="sv">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <title>Logga in · Skvallerbyttan</title>
  <style>
    :root { font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background:#0b0d10; color:#f4f7fb; font-synthesis:none; }
    * { box-sizing:border-box; }
    body { margin:0; min-height:100vh; display:grid; place-items:center; background:radial-gradient(circle at top,#18202c 0,#0b0d10 34rem); padding:20px; }
    .login-shell { width:min(520px,100%); }
    .eyebrow { margin:0 0 6px; text-transform:uppercase; letter-spacing:.13em; font-weight:700; font-size:.72rem; color:#7dd3fc; }
    h1 { margin:0 0 8px; font-size:clamp(2.2rem,8vw,3.5rem); letter-spacing:-.045em; }
    .subtitle { margin:0 0 24px; color:#9aa8ba; line-height:1.55; }
    .login-card { border:1px solid #253041; background:rgba(14,18,24,.9); border-radius:16px; box-shadow:0 18px 50px rgba(0,0,0,.2); padding:24px; }
    .login-card h2 { margin:0 0 8px; font-size:1.2rem; }
    .login-card p { color:#9aa8ba; line-height:1.55; }
    .login-button { display:flex; justify-content:center; width:100%; margin-top:20px; border:1px solid #334155; background:#eef6ff; color:#08111c; border-radius:10px; padding:11px 14px; font-weight:750; text-decoration:none; }
    .login-button:hover { filter:brightness(1.06); }
    .login-button.disabled { opacity:.45; cursor:not-allowed; }
    .login-alert { border:1px solid #7f1d1d; background:#2a1115; color:#fecaca !important; padding:10px 12px; border-radius:10px; }
    .small { margin:18px 0 0; color:#77869a !important; font-size:.78rem; }
  </style>
</head>
<body>
  <main class="login-shell">
    <p class="eyebrow">Avkroken</p>
    <h1>Skvallerbyttan</h1>
    <p class="subtitle">GitHub-hälsa, säkerhet, leverans och repo-statistik.</p>
    <section class="login-card" aria-labelledby="login-title">
      <h2 id="login-title">Privat dashboard</h2>
      <p>Krösa-Maja verifierar din GitHub-identitet. Endast uttryckligen tillåtna GitHub-konton släpps in.</p>
      ${alert}
      ${button}
      <p class="small">Inga Skvallerbyttan-konton skapas och GitHub-tokenen lagras inte.</p>
    </section>
  </main>
</body>
</html>`;

  return new Response(html, {
    status: ready ? 200 : 503,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    },
  });
}
