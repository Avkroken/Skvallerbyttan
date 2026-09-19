CREATE TABLE IF NOT EXISTS capability_observations (
  capability_key TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  permission_state TEXT NOT NULL,
  data_state TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  last_success_at TEXT,
  last_http_status INTEGER,
  last_error TEXT
);

CREATE INDEX IF NOT EXISTS idx_capability_observations_success
  ON capability_observations(last_success_at DESC);

CREATE TABLE IF NOT EXISTS observation_events (
  event_key TEXT PRIMARY KEY,
  provider TEXT NOT NULL CHECK (provider IN ('github', 'cloudflare')),
  capability TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('webhook', 'audit_log', 'snapshot_diff', 'reconciliation')),
  coverage TEXT NOT NULL CHECK (
    coverage IN ('complete', 'partial', 'sampled', 'since_installation', 'since_first_observation', 'unknown')
  ),
  event TEXT NOT NULL,
  action TEXT,
  resource_type TEXT,
  resource_id TEXT,
  repository TEXT,
  occurred_at TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_observation_events_capability_received
  ON observation_events(capability, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_observation_events_provider_received
  ON observation_events(provider, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_observation_events_repo_received
  ON observation_events(repository, received_at DESC);
