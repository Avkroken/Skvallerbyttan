import { cloudflareCasbWebhookSecret, cloudflareNotificationsWebhookSecret, type Env } from "./env";
import { cloudflareApiConfigured, getCloudflareBudget } from "./cloudflare";
import { getGitHubBudget } from "./github";

function githubConfigured(env: Env): boolean {
  return Boolean(
    env.SKVALLERBYTTAN_GAMNACKE_CLIENT_ID?.trim() &&
    env.SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY,
  );
}

function healthFromBudget(
  configured: boolean,
  budget: { observedAt: string | null; throttled: boolean; lastStatus: number | null },
): "available" | "not_configured" | "not_observed" | "permission_denied" | "error" {
  if (!configured) return "not_configured";
  if (!budget.observedAt) return "not_observed";
  if (budget.throttled) return "error";
  if (budget.lastStatus === 401 || budget.lastStatus === 403) return "permission_denied";
  if (budget.lastStatus != null && budget.lastStatus >= 400) return "error";
  return "available";
}

export function getProviderHealth(env: Env): Record<string, unknown> {
  const githubBudget = getGitHubBudget();
  const cloudflareBudget = getCloudflareBudget();
  const ghConfigured = githubConfigured(env);
  const cfConfigured = cloudflareApiConfigured(env);

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    providers: {
      github: {
        status: healthFromBudget(ghConfigured, githubBudget),
        auth: {
          configured: ghConfigured,
          lastObservedAt: githubBudget.observedAt,
          lastStatus: githubBudget.lastStatus,
        },
        webhook: {
          configured: Boolean(env.SKVALLERBYTTAN_WEBHOOK_SECRET?.trim() && env.STATS_DB),
        },
        reconciliation: {
          configured: Boolean(env.STATS_DB),
          lastSuccessAt: null,
          status: "unknown",
        },
        budget: githubBudget,
      },
      cloudflare: {
        status: healthFromBudget(cfConfigured, cloudflareBudget),
        auth: {
          configured: cfConfigured,
          lastObservedAt: cloudflareBudget.observedAt,
          lastStatus: cloudflareBudget.lastStatus,
        },
        webhooks: {
          notificationsConfigured: Boolean(
            cloudflareNotificationsWebhookSecret(env) && env.STATS_DB,
          ),
          casbConfigured: Boolean(
            cloudflareCasbWebhookSecret(env) && env.STATS_DB,
          ),
        },
        reconciliation: {
          configured: Boolean(env.STATS_DB),
          lastSuccessAt: null,
          status: "unknown",
        },
        budget: cloudflareBudget,
      },
    },
  };
}
