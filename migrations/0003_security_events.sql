CREATE TABLE IF NOT EXISTS security_events (
  delivery_id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  repo TEXT NOT NULL,
  alert_number INTEGER,
  action TEXT NOT NULL,
  severity TEXT,
  subject TEXT,
  resolution TEXT,
  received_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_security_events_repo_received
  ON security_events(repo, received_at);

CREATE INDEX IF NOT EXISTS idx_security_events_event_action_received
  ON security_events(event, action, received_at);
