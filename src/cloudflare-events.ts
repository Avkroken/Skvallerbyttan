import type { Env } from "./env";

export type CloudflareEventSource = "notifications" | "casb";

export type CloudflareEventRecord = {
  deliveryId: string;
  source: CloudflareEventSource;
  eventType: string;
  eventId: string | null;
  state: string | null;
  accountId: string | null;
  policyId: string | null;
  summary: string | null;
  occurredAt: string | null;
  receivedAt: string;
};

type ActivityCountRow = {
  source: string;
  event_type: string;
  state: string | null;
  count: number;
};

type RecentEventRow = {
  source: string;
  event_type: string;
  event_id: string | null;
  state: string | null;
  policy_id: string | null;
  summary: string | null;
  occurred_at: string | null;
  received_at: string;
};

type FirstRecordedRow = { first_recorded_at: string | null };

export async function recordCloudflareEvent(env: Env, event: CloudflareEventRecord): Promise<void> {
  if (!env.STATS_DB) return;
  await env.STATS_DB.prepare(
    `INSERT OR IGNORE INTO cloudflare_events (
       delivery_id, source, event_type, event_id, state, account_id, policy_id,
       summary, occurred_at, received_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    event.deliveryId,
    event.source,
    event.eventType,
    event.eventId,
    event.state,
    event.accountId,
    event.policyId,
    event.summary,
    event.occurredAt,
    event.receivedAt,
  ).run();
}

export async function pruneCloudflareEvents(env: Env, olderThanIso: string): Promise<void> {
  if (!env.STATS_DB) return;
  await env.STATS_DB.prepare(
    `DELETE FROM cloudflare_events WHERE received_at < ?`,
  ).bind(olderThanIso).run();
}

function requestedWindow(requestedDays: number): { days: number; since: string } {
  const days = Math.min(90, Math.max(1, Math.trunc(requestedDays || 30)));
  return {
    days,
    since: new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString(),
  };
}

export async function getCloudflareActivity(
  env: Env,
  requestedDays = 30,
): Promise<Record<string, unknown>> {
  if (!env.STATS_DB) return { available: false, reason: "d1-not-bound" };
  const { days, since } = requestedWindow(requestedDays);
  try {
    const [grouped, recent, first] = await Promise.all([
      env.STATS_DB.prepare(
        `SELECT source, event_type, state, COUNT(*) AS count
           FROM cloudflare_events
          WHERE received_at >= ?
          GROUP BY source, event_type, state
          ORDER BY count DESC, source, event_type`,
      ).bind(since).all<ActivityCountRow>(),
      env.STATS_DB.prepare(
        `SELECT source, event_type, event_id, state, policy_id, summary, occurred_at, received_at
           FROM cloudflare_events
          WHERE received_at >= ?
          ORDER BY received_at DESC
          LIMIT 25`,
      ).bind(since).all<RecentEventRow>(),
      env.STATS_DB.prepare(
        `SELECT MIN(received_at) AS first_recorded_at FROM cloudflare_events`,
      ).first<FirstRecordedRow>(),
    ]);

    return {
      available: true,
      days,
      since,
      firstRecordedAt: first?.first_recorded_at ?? null,
      grouped: (grouped.results ?? []).map((row) => ({
        source: row.source,
        eventType: row.event_type,
        state: row.state,
        count: Number(row.count),
      })),
      recent: (recent.results ?? []).map((row) => ({
        source: row.source,
        eventType: row.event_type,
        eventId: row.event_id,
        state: row.state,
        policyId: row.policy_id,
        summary: row.summary,
        occurredAt: row.occurred_at,
        receivedAt: row.received_at,
      })),
    };
  } catch (error) {
    console.error("cloudflare activity query failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { available: false, reason: "cloudflare-events-unavailable" };
  }
}
