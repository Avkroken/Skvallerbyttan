export type RuntimeHealthEnv = {
  SKVALLERBYTTAN_WEBHOOK_SECRET?: unknown;
  SKVALLERBYTTAN_CLIENT_ID?: unknown;
  SKVALLERBYTTAN_APP_PRIVATE_KEY?: unknown;
  SKVALLERBYTTAN_EMAIL_TO?: unknown;
  SKVALLERBYTTAN_EMAIL_FROM?: unknown;
  EMAIL?: unknown;
  SKVALLERBYTTAN_ISSUE_LOCK?: unknown;
};

export function runtimeReady(env: RuntimeHealthEnv): boolean {
  return Boolean(
    env.SKVALLERBYTTAN_WEBHOOK_SECRET &&
    env.SKVALLERBYTTAN_CLIENT_ID &&
    env.SKVALLERBYTTAN_APP_PRIVATE_KEY &&
    env.SKVALLERBYTTAN_EMAIL_TO &&
    env.SKVALLERBYTTAN_EMAIL_FROM &&
    env.EMAIL &&
    env.SKVALLERBYTTAN_ISSUE_LOCK
  );
}
