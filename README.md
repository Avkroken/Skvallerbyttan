# Skvallerbyttan

Central receiver and backfill service for security alerts in the Avkroken organization.

This README describes the intended behavior and setup of the current program. It is not an authoritative configuration source. When documentation and runtime behavior disagree, treat `src/index.ts`, `wrangler.jsonc`, deployed Cloudflare configuration, and GitHub App settings as the sources to verify first, then update this file to match reality.

`POST https://skvallerbyttan.denied.se/webhook` accepts organization webhook events for `code_scanning_alert`, `dependabot_alert`, and `secret_scanning_alert`, verifies `X-Hub-Signature-256`, and creates an Issue in the affected Avkroken repository when:

- Code Scanning severity is Medium, High, or Critical;
- Dependabot vulnerability severity is Medium, High, or Critical;
- Dependabot classification is malware, regardless of severity;
- a Secret Scanning alert is created or reopened. The detected secret itself is never copied into the Issue.

Issues are deduplicated by alert type and alert number inside the affected repository and assigned to `blixten85` so they surface in the GitHub mobile inbox. The hourly reconciliation also adds that assignee to existing open security Issues when it is missing. Assignment is temporarily paused for `Avkroken/produkter` while that repository is under active reconstruction; alert ingestion, deduplication, and state reconciliation continue unchanged. No personal access token is used. The organization webhook is only the event source. The Worker authenticates separately as the Gamnacken GitHub App, looks up Gamnacken's installation on `Avkroken` with an app JWT, exchanges that installation ID for a short-lived installation access token, and uses that token to create Issues and read alert metadata.

## Organization-wide backfill

The Worker reconciles all currently open security alerts across every repository in `Avkroken` once per hour at minute 17. It uses GitHub's organization-level Code Scanning, Dependabot, and Secret Scanning alert endpoints, then creates each eligible Issue in the repository that owns the alert.

The same run also reconciles Issue state against each alert's repository-level API state. Code Scanning and Dependabot state `fixed`, and Secret Scanning state `resolved`, close an open Issue. An alert that is still `open` reopens a prematurely closed Issue. Dismissed alerts are not treated as verified fixes. Fix/resolution webhook deliveries apply the same close behavior immediately, without waiting for the hourly schedule.

The backfill uses the same Issue markers as webhook delivery, so it is safe to run repeatedly. Alerts that already have their corresponding Issue are skipped.

A valid GitHub organization-webhook `ping` also starts the same backfill asynchronously after the signed ping has been verified. This provides a safe way to request an immediate reconciliation from GitHub's webhook delivery UI without exposing a public backfill endpoint.

## Automatic Codex remediation

Every five minutes, the Worker scans open security Issues and dispatches at most one Codex remediation per repository. Critical and malware findings are prioritized before high, Secret Scanning, and medium findings. A newly created webhook Issue also requests a queue pass immediately.

The Worker posts the request as Gamnacken so the `@codex` mention can start downstream automation. Requests are deduplicated with `skvallerbyttan-remediation:<skvallerbyttan marker>`, and an open `skvallerbyttan-remediation:active` Issue keeps later findings in that repository queued until the active Issue is closed by its merged PR.

Codex is instructed to use the repository's existing branch pool, open a squash PR with `Fixes #<issue>`, enable auto-merge immediately, and continue handling CI and trusted automated review feedback. Required checks, branch protection, review resolution, and the merge queue remain authoritative; the Worker never changes the underlying security alert state.

## Organization webhook

Configure the webhook under `Avkroken` → Settings → Webhooks:

- URL: `https://skvallerbyttan.denied.se/webhook`
- Content type: `application/json`
- Secret: a random secret shared with `SKVALLERBYTTAN_WEBHOOK_SECRET`
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

The Worker does not depend on an `installation` field in the organization webhook payload and does not require a configured installation ID. It creates an App JWT using Gamnacken's GitHub App Client ID as the `iss` claim, resolves the installation on `Avkroken` dynamically, and exchanges that installation ID for a short-lived installation access token.

Historically, the variable carrying this value was named as though it contained an App ID. The value used by the program has been the GitHub App Client ID. The current name, `SKVALLERBYTTAN_CLIENT_ID`, reflects what the value actually is.

## Cloudflare runtime configuration

The Worker is named `skvallerbyttan`. Its non-secret variables are defined in `wrangler.jsonc`; secrets must exist in the deployed Cloudflare Worker environment.

Required configuration:

- `SKVALLERBYTTAN_WEBHOOK_SECRET` — Secret; same value as the Avkroken organization webhook secret.
- `SKVALLERBYTTAN_CLIENT_ID` — Gamnacken's GitHub App Client ID. This is the value used as the JWT `iss` claim. It is not the numeric GitHub App ID.
- `SKVALLERBYTTAN_APP_PRIVATE_KEY` — Secret; the complete private key PEM belonging to the same Gamnacken GitHub App as `SKVALLERBYTTAN_CLIENT_ID`.
- `SKVALLERBYTTAN_EMAIL_TO` — destination address for Secret Scanning notifications.
- `SKVALLERBYTTAN_EMAIL_FROM` — sender address for Secret Scanning notifications.

The current implementation accepts both GitHub's downloaded PKCS#1 RSA private-key PEM (`-----BEGIN RSA PRIVATE KEY-----`) and PKCS#8 private-key PEM (`-----BEGIN PRIVATE KEY-----`). PKCS#1 is wrapped into PKCS#8 form in memory before import into Web Crypto, so a separate OpenSSL conversion step is not required by the current Worker.

Store the complete PEM, including the BEGIN/END lines, as `SKVALLERBYTTAN_APP_PRIVATE_KEY`. Never commit a private key.

The Client ID and private key must belong to the same GitHub App. A syntactically valid private key paired with a Client ID from another App can still produce a validly signed JWT that GitHub cannot use to resolve the expected installation.

## Scheduled jobs

The Worker currently has two Cloudflare cron triggers:

- `17 * * * *` — organization-wide security-alert backfill.
- `*/5 * * * *` — Codex remediation queue processing.

The cron schedules are defined in `wrangler.jsonc`.

## Authentication model

`GITHUB_TOKEN` is not used.

GitHub API access follows this sequence:

1. Build an App JWT with `SKVALLERBYTTAN_CLIENT_ID` as `iss` and sign it with `SKVALLERBYTTAN_APP_PRIVATE_KEY`.
2. Resolve Gamnacken's installation on `Avkroken` with `GET /orgs/Avkroken/installation`.
3. Exchange that installation ID for a short-lived installation access token.
4. Use the installation token for Issues, security-alert metadata, search, and remediation operations.

Per-repository polling or snapshot workflows are not required for the Worker's own backfill logic.
