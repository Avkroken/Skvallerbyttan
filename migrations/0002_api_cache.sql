CREATE TABLE IF NOT EXISTS api_cache (
  cache_key TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  payload TEXT NOT NULL,
  refreshed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_cache_kind_refreshed
  ON api_cache(kind, refreshed_at);

CREATE TABLE IF NOT EXISTS cache_invalidations (
  cache_key TEXT PRIMARY KEY,
  reason TEXT NOT NULL,
  invalidated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  repo TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_received
  ON webhook_deliveries(received_at);
