import type { Env } from "./env";
import { organization } from "./env";

const API_VERSION = "2026-03-10";
const USER_AGENT = "Avkroken-Skvallerbyttan-dashboard";

type InstallationToken = { value: string; expiresAt: number };
let installationTokenCache: InstallationToken | null = null;
let installationTokenInFlight: Promise<InstallationToken> | null = null;

export type OptionalResult<T> =
  | { available: true; value: T; status: number }
  | { available: false; value: null; status: number; reason: string };

export type ListResult<T> = OptionalResult<T[]> & { truncated: boolean };

export class GitHubApiError extends Error {
  constructor(public readonly status: number, message: string) {
    super(message);
    this.name = "GitHubApiError";
  }
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
  const body = pem.replace(
    /-----BEGIN (?:RSA )?PRIVATE KEY-----|-----END (?:RSA )?PRIVATE KEY-----|\s/g,
    "",
  );
  if (!body) throw new Error("GitHub App private key PEM is empty or invalid");
  const binary = atob(body);
  const keyBytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
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

async function appJwt(env: Env): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({
    iat: now - 60,
    exp: now + 540,
    iss: env.SKVALLERBYTTAN_GAMNACKE_CLIENT_ID,
  }));
  const unsigned = `${header}.${payload}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemPkcs8Bytes(env.SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64url(signature)}`;
}

async function mintInstallationToken(env: Env): Promise<InstallationToken> {
  const jwt = await appJwt(env);
  const org = organization(env);
  const installationResponse = await fetch(
    `https://api.github.com/orgs/${encodeURIComponent(org)}/installation`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
      },
    },
  );
  if (!installationResponse.ok) {
    throw new Error(
      `GitHub installation lookup ${installationResponse.status}: ${(await installationResponse.text()).slice(0, 300)}`,
    );
  }
  const installation = await installationResponse.json<{ id?: number }>();
  if (!Number.isSafeInteger(installation.id) || Number(installation.id) <= 0) {
    throw new Error("GitHub installation id missing");
  }

  const response = await fetch(
    `https://api.github.com/app/installations/${installation.id}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "X-GitHub-Api-Version": API_VERSION,
        "User-Agent": USER_AGENT,
      },
    },
  );
  if (!response.ok) {
    throw new Error(
      `GitHub installation token ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  const data = await response.json<{ token?: string; expires_at?: string }>();
  if (!data.token) throw new Error("GitHub installation token missing");
  const expiresAt = Date.parse(data.expires_at || "");
  if (!Number.isFinite(expiresAt)) throw new Error("GitHub installation token expiry missing");
  return { value: data.token, expiresAt };
}

async function installationToken(env: Env): Promise<string> {
  if (installationTokenCache && installationTokenCache.expiresAt - Date.now() > 120_000) {
    return installationTokenCache.value;
  }

  installationTokenInFlight ??= mintInstallationToken(env).finally(() => {
    installationTokenInFlight = null;
  });
  installationTokenCache = await installationTokenInFlight;
  return installationTokenCache.value;
}

function headers(token: string, additional?: HeadersInit): Headers {
  const result = new Headers(additional);
  result.set("Accept", "application/vnd.github+json");
  result.set("Authorization", `Bearer ${token}`);
  result.set("X-GitHub-Api-Version", API_VERSION);
  result.set("User-Agent", USER_AGENT);
  return result;
}

export async function githubResponse(
  env: Env,
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  const request = async (token: string): Promise<Response> => fetch(`https://api.github.com${path}`, {
    ...init,
    headers: headers(token, init.headers),
  });

  let token = await installationToken(env);
  let response = await request(token);
  if (response.status === 401) {
    installationTokenCache = null;
    token = await installationToken(env);
    response = await request(token);
  }
  return response;
}

export async function githubJson<T>(env: Env, path: string): Promise<T> {
  const response = await githubResponse(env, path);
  if (!response.ok) {
    throw new GitHubApiError(
      response.status,
      `GitHub API ${response.status}: ${(await response.text()).slice(0, 300)}`,
    );
  }
  return response.json<T>();
}

export async function githubOptionalJson<T>(env: Env, path: string): Promise<OptionalResult<T>> {
  try {
    const response = await githubResponse(env, path);
    if (!response.ok) {
      return {
        available: false,
        value: null,
        status: response.status,
        reason: (await response.text()).slice(0, 220) || `GitHub API ${response.status}`,
      };
    }
    return { available: true, value: await response.json<T>(), status: response.status };
  } catch (error) {
    return {
      available: false,
      value: null,
      status: 0,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}

function nextPath(link: string | null): string | null {
  if (!link) return null;
  const next = link.split(",").find((part) => part.includes('rel="next"'));
  const match = next?.match(/<https:\/\/api\.github\.com([^>]+)>/);
  return match?.[1] ?? null;
}

export async function githubListAll<T>(
  env: Env,
  initialPath: string,
  maxPages = 10,
): Promise<ListResult<T>> {
  const items: T[] = [];
  let path: string | null = initialPath;
  let pages = 0;

  try {
    while (path && pages < maxPages) {
      const response = await githubResponse(env, path);
      if (!response.ok) {
        return {
          available: false,
          value: null,
          status: response.status,
          reason: (await response.text()).slice(0, 220) || `GitHub API ${response.status}`,
          truncated: false,
        };
      }
      const page = await response.json<T[]>();
      items.push(...page);
      path = nextPath(response.headers.get("link"));
      pages += 1;
    }
  } catch (error) {
    return {
      available: false,
      value: null,
      status: 0,
      reason: error instanceof Error ? error.message : String(error),
      truncated: false,
    };
  }

  return {
    available: true,
    value: items,
    status: 200,
    truncated: path !== null,
  };
}

export async function mapLimit<T, R>(
  values: T[],
  limit: number,
  fn: (value: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(values.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= values.length) return;
      results[index] = await fn(values[index], index);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, values.length) }, () => worker()));
  return results;
}
