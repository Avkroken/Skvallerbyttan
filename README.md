# Skvallerbyttan

Central receiver and backfill service for security alerts in the Avkroken organization.

`POST https://security-alerts.denied.se/webhook` accepts organization webhook events for `code_scanning_alert`, `dependabot_alert`, and `secret_scanning_alert`, verifies `X-Hub-Signature-256`, and creates an Issue in the affected Avkroken repository when:

- Code Scanning severity is Medium, High, or Critical;
- Dependabot vulnerability severity is Medium, High, or Critical;
- Dependabot classification is malware, regardless of severity;
- a Secret Scanning alert is created or reopened. The detected secret itself is never copied into the Issue.

Issues are deduplicated by alert type and alert number inside the affected repository. No personal access token is used. The organization webhook is only the event source. The Worker authenticates separately as the Gamnacken GitHub App, looks up Gamnacken's installation on `Avkroken` with an app JWT, exchanges that installation ID for a short-lived installation access token, and uses that token to create Issues and read alert metadata.

## Organization-wide backfill

The Worker also reconciles all currently open security alerts across every repository in `Avkroken` once per hour at minute 17. It uses GitHub's organization-level Code Scanning, Dependabot, and Secret Scanning alert endpoints, then creates each eligible Issue in the repository that owns the alert.

The backfill uses the same Issue markers as webhook delivery, so it is safe to run repeatedly. Alerts that already have their corresponding Issue are skipped.

## Automatic Codex remediation

Every five minutes, the Worker scans open security Issues and dispatches at most one Codex remediation per repository. Critical and malware findings are prioritized before high, Secret Scanning, and medium findings. A newly created webhook Issue also requests a queue pass immediately.

The Worker posts the request as Gamnacken so the `@codex` mention can start downstream automation. Requests are deduplicated with `codex-security-remediation:<security marker>`, and an open `codex-security-remediation:active` Issue keeps later findings in that repository queued until the active Issue is closed by its merged PR.

Codex is instructed to use the repository's existing branch pool, open a squash PR with `Fixes #<issue>`, enable auto-merge immediately, and continue handling CI and trusted automated review feedback. Required checks, branch protection, review resolution, and the merge queue remain authoritative; the Worker never changes the underlying security alert state.

A valid GitHub organization-webhook `ping` also starts the same backfill asynchronously after the signed ping has been verified. This provides a safe way to request an immediate reconciliation from GitHub's webhook delivery UI without exposing a public backfill endpoint.

## Organization webhook

Configure the webhook under `Avkroken` → Settings → Webhooks:

- URL: `https://security-alerts.denied.se/webhook`
- Content type: `application/json`
- Secret: a random secret shared with `SECURITY_ISSUE_WEBHOOK_SECRET`
- Active: enabled
- Events: `Code scanning alerts`, `Dependabot alerts`, and `Secret scanning alerts`

Do not also send the same security alert events from the Gamnacken GitHub App webhook to this endpoint. If both webhook sources deliver the same event, the Worker will normally deduplicate the resulting Issue, but the duplicate delivery is unnecessary.

## GitHub App

Gamnacken is used for GitHub API authentication, not as the security-event source. It should be installed on `Avkroken` with access to all repositories that should receive security Issues.

Required repository permissions for this Worker:

- `Issues`: Read & write
- `Dependabot alerts`: Read-only
- `Code scanning alerts`: Read-only
- `Secret scanning alerts`: Read-only

The Worker does not depend on an `installation` field in the organization webhook payload. Instead, it uses its App JWT to resolve the Gamnacken installation dynamically.

## Cloudflare runtime configuration

Set these on the existing Worker `security-alert-ingest`:

- `SECURITY_ISSUE_WEBHOOK_SECRET` — Secret; same value as the Avkroken organization webhook secret.
- `SECURITY_ISSUE_APP_ID` — the Gamnacken GitHub App ID.
- `SECURITY_ISSUE_APP_PRIVATE_KEY` — Secret; the app private key in unencrypted PKCS#8 PEM format.

GitHub downloads new App private keys as PKCS#1 PEM. Convert it locally before storing it in Cloudflare:

```bash
openssl pkcs8 -topk8 -nocrypt -in downloaded-app-key.pem -out github-app-key-pkcs8.pem
```

Store the complete contents of `github-app-key-pkcs8.pem` as `SECURITY_ISSUE_APP_PRIVATE_KEY`. Never commit either private-key file.

`GITHUB_TOKEN` is not used. Per-repository polling/snapshot workflows are not required by this Worker.
