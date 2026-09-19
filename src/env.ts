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
  SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID?: string;
  SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN?: string;
  SKVALLERBYTTAN_CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET?: string;
  SKVALLERBYTTAN_CLOUDFLARE_CASB_WEBHOOK_SECRET?: string;
  SKVALLERBYTTAN_ALLOWED_GITHUB_IDS?: string;
  SKVALLERBYTTAN_ORG?: string;
}

export function organization(env: Env): string {
  return env.SKVALLERBYTTAN_ORG?.trim() || "Avkroken";
}
