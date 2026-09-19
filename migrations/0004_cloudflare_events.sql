CREATE TABLE IF NOT EXISTS cloudflare_events (
  delivery_id TEXT PRIMARY KEY,
  source TEXT NOT NULL CHECK (source IN ('notifications', 'casb')),
  event_type TEXT NOT NULL,
  event_id TEXT,
  state TEXT,
  account_id TEXT,
  policy_id TEXT,
  summary TEXT,
  occurred_at TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_cloudflare_events_source_received
  ON cloudflare_events(source, received_at);

CREATE INDEX IF NOT EXISTS idx_cloudflare_events_type_state_received
  ON cloudflare_events(event_type, state, received_at);
