import { cloudflareAccountId, cloudflareApiToken, type Env } from "./env";

export type ReadConsumer = "dashboard" | "chatgpt" | "reconciliation" | "background_refresh" | "internal";
export type ReadResult = "ok" | "error" | "permission_denied" | "stale";

const DATASET = "skvallerbyttan_observability";
const ACCOUNT_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function recordReadTelemetry(
  env: Env,
  input: {
    capability: string;
    provider: "github" | "cloudflare" | "internal";
    consumer: ReadConsumer;
    operation: string;
    result: ReadResult;
    cache: "hit" | "stale" | "miss" | "none";
    durationMs: number;
  },
): void {
  if (!env.OBSERVABILITY) return;
  try {
    env.OBSERVABILITY.writeDataPoint({
      indexes: [input.capability.slice(0, 96)],
      blobs: [
        input.provider,
        input.consumer,
        input.operation.slice(0, 120),
        input.result,
        input.cache,
      ],
      doubles: [1, Math.max(0, input.durationMs)],
    });
  } catch (error) {
    console.error("analytics engine telemetry write failed", {
      capability: input.capability,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function getReadTelemetry(env: Env, requestedDays = 30): Promise<Record<string, unknown>> {
  const accountId = cloudflareAccountId(env);
  const token = cloudflareApiToken(env);
  if (!ACCOUNT_ID.test(accountId) || !token) {
    return { schemaVersion: 1, available: false, status: "not_configured", reason: "cloudflare-api-not-configured" };
  }

  const days = Math.min(90, Math.max(1, Math.trunc(Number.isFinite(requestedDays) ? requestedDays : 30)));
  const sql = `
    SELECT
      index1 AS capability,
      blob1 AS provider,
      blob2 AS consumer,
      blob3 AS operation,
      blob4 AS result,
      blob5 AS cache,
      SUM(_sample_interval * double1) AS reads,\n      SUM(_sample_interval * double2) / SUM(_sample_interval) AS avg_duration_ms
    FROM ${DATASET}
    WHERE timestamp >= NOW() - INTERVAL '${days}' DAY
    GROUP BY capability, provider, consumer, operation, result, cache
    ORDER BY reads DESC
    LIMIT 1000
  `.trim();

  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}/analytics_engine/sql`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "text/plain; charset=utf-8",
      },
      body: sql,
    },
  );

  if (!response.ok) {
    return {
      schemaVersion: 1,
      available: false,
      status: response.status === 401 || response.status === 403 ? "permission_denied" : "error",
      httpStatus: response.status,
      reason: response.status === 401 || response.status === 403
        ? "Account Analytics: read is required to query read telemetry."
        : `Cloudflare Analytics Engine query failed (${response.status})`,
    };
  }

  const body = await response.json<{ data?: Array<Record<string, unknown>> }>();
  return {
    schemaVersion: 1,
    available: true,
    status: "available",
    days,
    rows: Array.isArray(body.data) ? body.data : [],
  };
}
