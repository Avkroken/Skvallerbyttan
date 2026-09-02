export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBinding;
  STATS_DB?: D1Database;
  SKVALLERBYTTAN_GAMNACKE_CLIENT_ID: string;
  SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY: string;
  SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID: string;
  SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET: string;
  SKVALLERBYTTAN_SESSION_SECRET: string;
  SKVALLERBYTTAN_ALLOWED_GITHUB_IDS?: string;
  SKVALLERBYTTAN_ORG?: string;
}

export function organization(env: Env): string {
  return env.SKVALLERBYTTAN_ORG?.trim() || "Avkroken";
}
