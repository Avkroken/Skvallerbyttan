# REPO.md

`Skvallerbyttan` is Avkroken's authenticated GitHub statistics dashboard running as a Cloudflare Worker with D1 history.

## Invariants

- `main` is the only permanent branch.
- Dashboard data/assets and `/api/*` stay authenticated. Public auth endpoints must not expose dashboard data.
- GitHub App private keys, installation tokens, OAuth/session secrets and Secret Scanning values must never be committed, logged, stored in D1 or sent to clients.
- The OAuth user token is used only for identity lookup during login and is not persisted. Access is bound to numeric GitHub user IDs, not mutable login names.
- Statistics collection uses minimum read permissions and must not add write operations against other repositories.
- `src/metrics.ts` remains pure/testable without network calls. Sampled/truncated or derived metrics must be identified as such.
- `wrangler.jsonc` is the source of truth for versioned Worker configuration; Cloudflare Workers Builds owns production deployment from `main`.

## Validation

Run `npm run check` for relevant changes and verify that no credential/secret payload is introduced.

The live repository rules currently require `CI / required`. Do not rename a required check without updating and verifying the live ruleset in the same migration.
