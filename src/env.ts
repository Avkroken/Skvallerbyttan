export interface AssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface Env {
  ASSETS: AssetsBinding;
  SKVALLERBYTTAN_CLIENT_ID: string;
  SKVALLERBYTTAN_APP_PRIVATE_KEY: string;
  SKVALLERBYTTAN_DASHBOARD_PASSWORD?: string;
  SKVALLERBYTTAN_DASHBOARD_USERNAME?: string;
  SKVALLERBYTTAN_ORG?: string;
}

export function organization(env: Env): string {
  return env.SKVALLERBYTTAN_ORG?.trim() || "Avkroken";
}
