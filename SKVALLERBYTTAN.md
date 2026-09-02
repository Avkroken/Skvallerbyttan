# SKVALLERBYTTAN.md

This is the repository governance document for `Avkroken/Skvallerbyttan`. Binding AI coding-agent policy is defined only in `Avkroken/.github/AGENTS.md`. This document records repository-specific technical contracts, invariants, validation requirements, and operational context required by that policy; it must not define, supplement, narrow, or override agent policy.

Live GitHub rules and required checks are intentionally not duplicated here; inspect current repository and organization enforcement when merge eligibility matters.

## Repository architecture

`Skvallerbyttan` is Avkroken's GitHub statistics dashboard.

- `src/worker.ts`: HTTP boundary, auth gating, caching and static assets.
- `src/auth.ts`: Krösa-Maja OAuth, PKCE/state, allowlist and signed session cookies.
- `src/github.ts`: Gamnacke GitHub App JWT, installation token and GitHub REST calls.
- `src/data.ts`: organization and repository aggregation.
- `src/insights.ts`: sample-based PR, Actions, deployment and activity trends.
- `src/history.ts`: D1 snapshots, history queries and “Sedan sist” deltas.
- `src/metrics.ts`: must remain pure and testable without network calls.
- `public/`: dashboard client.
- `migrations/`: versioned D1 migrations for statistics, never credentials.
- `wrangler.jsonc`: source of truth for versioned Worker configuration and the custom domain.
- Cloudflare Workers Builds owns normal production deployment from `main`.

`main` is the only permanent branch. Do not introduce a permanent `dev` branch for this repository.

## Data protection

- Gamnacke's GitHub App private key, installation tokens, Krösa-Maja OAuth client secret, session secret and other credentials must never be committed, logged or sent to the client.
- The OAuth user token may be used only for identity lookup during login and must not be stored or sent to the client.
- Secret Scanning secret values must never be returned from the API, rendered in the UI, stored in D1 or logged. Only aggregate statistics and non-secret type metadata may be exposed.
- D1 statistics history may contain only aggregated/derived metrics and non-secret repository identities/timestamps; never tokens, private keys or credential payloads.
- Dashboard data, dashboard assets and `/api/*` must remain authenticated. `/login`, OAuth callback and logout are intentionally public auth surfaces and must not expose dashboard data.
- Access is bound to numeric GitHub user IDs in an explicit allowlist; GitHub login names are not permanent identity keys.
- New GitHub endpoints use the minimum necessary read permission and degrade clearly when a permission is missing.
- Statistics collection must not add write operations against other repositories.

## GitHub statistics semantics

Prioritize metrics in this order:

1. security risk and delivery health;
2. repository health and traffic;
3. historical trends and derived metrics.

Mark metrics as sampled/truncated when the API does not provide full history. Derived metrics such as attention score must not be presented as GitHub-native statistics.

## Cloudflare invariants

- `wrangler.jsonc` keeps Worker name `skvallerbyttan` and custom domain `skvallerbyttan.denied.se`.
- GitHub Actions must not duplicate production deployment; Cloudflare Workers Builds owns it.
- Runtime secrets belong in Cloudflare, not Git or GitHub Actions.
- `assets.run_worker_first` must remain enabled so authentication cannot be bypassed through static assets.
- D1 binding `STATS_DB` remains optional until a real Cloudflare D1 database exists and its actual `database_id` is versioned. Never commit a placeholder production ID.
- Apply D1 migrations to the correct database before a deployment that makes the binding mandatory.

## Validation

Run `npm run check` for relevant changes and verify that no credential or secret payload is introduced.
