import type { Env } from "./env";

export type SourceCacheKind = "overview" | "repository" | "insights";

export type SourceCacheEntry<T> = {
  value: T;
  refreshedAt: string;
};

type SourceCacheRow = {
  payload: string;
  refreshed_at: string;
};

export function sourceCacheConfigured(env: Env): boolean {
  return Boolean(env.STATS_DB);
}

export function sourceCacheAgeMs(refreshedAt: string, now = Date.now()): number {
  const timestamp = Date.parse(refreshedAt);
  if (!Number.isFinite(timestamp)) return Number.POSITIVE_INFINITY;
  return Math.max(0, now - timestamp);
}

export async function readSourceCache<T>(env: Env, key: string): Promise<SourceCacheEntry<T> | null> {
  if (!env.STATS_DB) return null;
  const row = await env.STATS_DB.prepare(
    `SELECT payload, refreshed_at
       FROM api_cache
      WHERE cache_key = ?
      LIMIT 1`,
  ).bind(key).first<SourceCacheRow>();
  if (!row) return null;
  return {
    value: JSON.parse(row.payload) as T,
    refreshedAt: row.refreshed_at,
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
  await env.STATS_DB.prepare(
    `INSERT INTO api_cache (cache_key, kind, payload, refreshed_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET
       kind = excluded.kind,
       payload = excluded.payload,
       refreshed_at = excluded.refreshed_at`,
  ).bind(key, kind, JSON.stringify(value), refreshedAt).run();
}
