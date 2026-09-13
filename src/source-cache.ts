import type { Env } from "./env";

export type SourceCacheKind = "overview" | "repository" | "insights";

export type SourceCacheEntry<T> = {
  value: T;
  refreshedAt: string;
  invalidatedAt: string | null;
  invalidationReason: string | null;
};

type SourceCacheRow = {
  payload: string;
  refreshed_at: string;
  invalidated_at: string | null;
  invalidation_reason: string | null;
};

export function sourceCacheConfigured(env: Env): boolean {
  return Boolean(env.STATS_DB);
}

export function sourceCacheAgeMs(refreshedAt: string, now = Date.now()): number {
  const timestamp = Date.parse(refreshedAt);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - timestamp);
}

export function sourceCacheInvalidated(entry: SourceCacheEntry<unknown>): boolean {
  if (!entry.invalidatedAt) return false;
  const invalidated = Date.parse(entry.invalidatedAt);
  const refreshed = Date.parse(entry.refreshedAt);
  if (!Number.isFinite(invalidated) || !Number.isFinite(refreshed)) return true;
  return invalidated > refreshed;
}

export async function readSourceCache<T>(env: Env, key: string): Promise<SourceCacheEntry<T> | null> {
  if (!env.STATS_DB) return null;
  const row = await env.STATS_DB.prepare(
    `SELECT c.payload, c.refreshed_at,
            i.invalidated_at, i.reason AS invalidation_reason
       FROM api_cache c
       LEFT JOIN cache_invalidations i ON i.cache_key = c.cache_key
      WHERE c.cache_key = ?
      LIMIT 1`,
  ).bind(key).first<SourceCacheRow>();
  if (!row) return null;
  return {
    value: JSON.parse(row.payload) as T,
    refreshedAt: row.refreshed_at,
    invalidatedAt: row.invalidated_at,
    invalidationReason: row.invalidation_reason,
  };
}

export async function writeSourceCache(
  env: Env,
  key: string,
  kind: SourceCacheKind,
  value: unknown,
  refreshedAt = new Date().toISOString(),
): Promise<void> {
  if (!env.STATS_DB) return;
  await env.STATS_DB.batch([
    env.STATS_DB.prepare(
      `INSERT INTO api_cache (cache_key, kind, payload, refreshed_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(cache_key) DO UPDATE SET
         kind = excluded.kind,
         payload = excluded.payload,
         refreshed_at = excluded.refreshed_at`,
    ).bind(key, kind, JSON.stringify(value), refreshedAt),
    env.STATS_DB.prepare(`DELETE FROM cache_invalidations WHERE cache_key = ?`).bind(key),
  ]);
}

export async function invalidateSourceCache(
  env: Env,
  keys: string[],
  reason: string,
  invalidatedAt = new Date().toISOString(),
): Promise<void> {
  if (!env.STATS_DB || keys.length === 0) return;
  const unique = [...new Set(keys)];
  await env.STATS_DB.batch(unique.map((key) => env.STATS_DB!.prepare(
    `INSERT INTO cache_invalidations (cache_key, reason, invalidated_at)
     VALUES (?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       reason = excluded.reason,
       invalidated_at = excluded.invalidated_at`,
  ).bind(key, reason, invalidatedAt)));
}

export async function recordWebhookDelivery(
  env: Env,
  deliveryId: string,
  event: string,
  repo: string | null,
  receivedAt = new Date().toISOString(),
): Promise<boolean> {
  if (!env.STATS_DB) return true;
  const result = await env.STATS_DB.prepare(
    `INSERT OR IGNORE INTO webhook_deliveries (delivery_id, event, repo, received_at)
     VALUES (?, ?, ?, ?)`,
  ).bind(deliveryId, event, repo, receivedAt).run();
  return Number(result.meta.changes ?? 0) > 0;
}

export async function pruneWebhookDeliveries(env: Env, olderThanIso: string): Promise<void> {
  if (!env.STATS_DB) return;
  await env.STATS_DB.prepare(
    `DELETE FROM webhook_deliveries WHERE received_at < ?`,
  ).bind(olderThanIso).run();
}
