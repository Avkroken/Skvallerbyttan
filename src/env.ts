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
  SKVALLERBYTTAN_GAMNACKE_CLIENT_ID: string;
  SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY: string;
  SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID: string;
  SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET: string;
  SKVALLERBYTTAN_SESSION_SECRET: string;
  SKVALLERBYTTAN_READ_API_TOKEN?: string;
  SKVALLERBYTTAN_WEBHOOK_SECRET?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
  CLOUDFLARE_API_TOKEN_R1?: SecretValue;
  CLOUDFLARE_API_TOKEN_R2?: SecretValue;
  CLOUDFLARE_API_TOKEN_R3?: SecretValue;
  CLOUDFLARE_API_TOKEN?: string;
  CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET?: string;
  CLOUDFLARE_CASB_WEBHOOK_SECRET?: string;
  // Temporary migration aliases. Canonical runtime bindings are CLOUDFLARE_*.
  SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID?: string;
  SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN?: string;
  SKVALLERBYTTAN_CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET?: string;
  SKVALLERBYTTAN_CLOUDFLARE_CASB_WEBHOOK_SECRET?: string;
  SKVALLERBYTTAN_ALLOWED_GITHUB_IDS?: string;
  SKVALLERBYTTAN_ORG?: string;
}

function firstConfigured(...values: Array<string | undefined>): string {
  for (const value of values) {
    const configured = value?.trim();
    if (configured) return configured;
  }
  return "";
}

export function cloudflareAccountId(env: Env): string {
  return firstConfigured(env.CLOUDFLARE_ACCOUNT_ID, env.SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID);
}

export type CloudflareReadCredentialClass = "r1" | "r2" | "r3";

function hasSecretValue(value: SecretValue | undefined): boolean {
  return typeof value === "string" ? Boolean(value.trim()) : Boolean(value);
}

async function resolveSecretValue(value: SecretValue | undefined): Promise<string> {
  if (typeof value === "string") return value.trim();
  if (!value) return "";
  return (await value.get()).trim();
}

export function cloudflareApiTokenConfigured(
  env: Env,
  credentialClass: CloudflareReadCredentialClass,
): boolean {
  const classToken = credentialClass === "r1"
    ? env.CLOUDFLARE_API_TOKEN_R1
    : credentialClass === "r2"
      ? env.CLOUDFLARE_API_TOKEN_R2
      : env.CLOUDFLARE_API_TOKEN_R3;

  return hasSecretValue(classToken)
    || Boolean(firstConfigured(env.CLOUDFLARE_API_TOKEN, env.SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN));
}

export async function cloudflareApiToken(
  env: Env,
  credentialClass: CloudflareReadCredentialClass,
): Promise<string> {
  const classToken = credentialClass === "r1"
    ? env.CLOUDFLARE_API_TOKEN_R1
    : credentialClass === "r2"
      ? env.CLOUDFLARE_API_TOKEN_R2
      : env.CLOUDFLARE_API_TOKEN_R3;

  const classValue = await resolveSecretValue(classToken);
  if (classValue) return classValue;

  return firstConfigured(
    env.CLOUDFLARE_API_TOKEN,
    env.SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN,
  );
}

export function cloudflareNotificationsWebhookSecret(env: Env): string {
  return firstConfigured(
    env.CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET,
    env.SKVALLERBYTTAN_CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET,
  );
}

export function cloudflareCasbWebhookSecret(env: Env): string {
  return firstConfigured(
    env.CLOUDFLARE_CASB_WEBHOOK_SECRET,
    env.SKVALLERBYTTAN_CLOUDFLARE_CASB_WEBHOOK_SECRET,
  );
}

export function organization(env: Env): string {
  return env.SKVALLERBYTTAN_ORG?.trim() || "Avkroken";
}
