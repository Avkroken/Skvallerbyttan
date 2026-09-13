CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_cache_kind_refreshed
  ON api_cache(kind, refreshed_at);
