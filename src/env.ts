export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface AnalyticsEngineBinding {
  writeDataPoint(point: {
    indexes?: string[];
    blobs?: string[];
    doubles?: number[];
  }): void;
}

export interface SecretsStoreSecretBinding {
  get(): Promise<string>;
}

export type SecretValue = string | SecretsStoreSecretBinding;

export interface Env {
  ASSETS: AssetsBinding;
  STATS_DB?: D1Database;
  OBSERVABILITY?: AnalyticsEngineBinding;

  GAMNACKEN_GITHUB_APP_CLIENT_ID: string;
  GAMNACKEN_GITHUB_APP_PRIVATE_KEY: SecretValue;

  KROSA_MAJA_GITHUB_CLIENT_ID: string;
  KROSA_MAJA_CLIENT_SECRET: SecretValue;

  SKVALLERBYTTAN_SESSION_SECRET: string;
  SKVALLERBYTTAN_READ_API_TOKEN?: string;
  SKVALLERBYTTAN_GITHUB_WEBHOOK_SECRET?: SecretValue;
  SKVALLERBYTTAN_CLOUDFLARE_WEBHOOK_SECRET?: SecretValue;

  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN_R1?: SecretValue;
  CLOUDFLARE_API_TOKEN_R2?: SecretValue;
  CLOUDFLARE_API_TOKEN_R3?: SecretValue;

  SKVALLERBYTTAN_ALLOWED_GITHUB_IDS?: string;
  SKVALLERBYTTAN_ORG?: string;
}

export function secretValueConfigured(value: SecretValue | undefined): boolean {
  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

export async function resolveSecretValue(value: SecretValue | undefined): Promise<string> {
  if (typeof value === "string") return value.trim();
  if (!value) return "";
  return (await value.get()).trim();
}

export function cloudflareAccountId(env: Env): string {
  return env.CLOUDFLARE_ACCOUNT_ID?.trim() || "";
}

export type CloudflareReadCredentialClass = "r1" | "r2" | "r3";

function classToken(
  env: Env,
  credentialClass: CloudflareReadCredentialClass,
): SecretValue | undefined {
  return credentialClass === "r1"
    ? env.CLOUDFLARE_API_TOKEN_R1
    : credentialClass === "r2"
      ? env.CLOUDFLARE_API_TOKEN_R2
      : env.CLOUDFLARE_API_TOKEN_R3;
}

export function cloudflareApiTokenConfigured(
  env: Env,
  credentialClass: CloudflareReadCredentialClass,
): boolean {
  return secretValueConfigured(classToken(env, credentialClass));
}

export async function cloudflareApiToken(
  env: Env,
  credentialClass: CloudflareReadCredentialClass,
): Promise<string> {
  return resolveSecretValue(classToken(env, credentialClass));
}

export function organization(env: Env): string {
  return env.SKVALLERBYTTAN_ORG?.trim() || "Avkroken";
}
