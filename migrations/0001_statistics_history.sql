CREATE TABLE IF NOT EXISTS org_snapshots (
  bucket TEXT PRIMARY KEY,
  captured_at TEXT NOT NULL,
  repository_count INTEGER NOT NULL,
  open_issues INTEGER NOT NULL,
  open_pull_requests INTEGER NOT NULL,
  stale_pull_requests INTEGER NOT NULL,
  action_sample_pass_rate REAL,
  failed_runs_last_7d_sample INTEGER,
  code_scanning_alerts INTEGER NOT NULL,
  dependabot_alerts INTEGER NOT NULL,
  secret_scanning_alerts INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS repo_snapshots (
  bucket TEXT NOT NULL,
  repo TEXT NOT NULL,
  captured_at TEXT NOT NULL,
  attention_score INTEGER NOT NULL,
  open_issues INTEGER NOT NULL,
  open_pull_requests INTEGER,
  stale_pull_requests INTEGER,
  action_sample_pass_rate REAL,
  failed_runs_last_7d_sample INTEGER,
  code_scanning_alerts INTEGER NOT NULL,
  dependabot_alerts INTEGER NOT NULL,
  secret_scanning_alerts INTEGER NOT NULL,
  pushed_at TEXT,
  PRIMARY KEY (bucket, repo)
);

CREATE INDEX IF NOT EXISTS idx_org_snapshots_captured_at
  ON org_snapshots(captured_at DESC);

CREATE INDEX IF NOT EXISTS idx_repo_snapshots_repo_captured_at
  ON repo_snapshots(repo, captured_at DESC);
