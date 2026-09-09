# Repository automation inventory

## Application and deployment

- The application is a TypeScript Cloudflare Worker with static assets and a D1 migration.
- The supported local gate is `npm run check`: Node test runner tests, TypeScript type checking, and a Wrangler dry-run build.
- Production deployment is intentionally not performed by GitHub Actions. Cloudflare configuration remains in `wrangler.jsonc`.

## GitHub automation

- `CI` runs the repository gate on Node.js 22.
- `CodeQL` scans the repository's `javascript-typescript` and `actions` languages.
- `Labeler` applies path-based scope, risk, security-sensitivity, and complexity labels to pull requests.
- `Release` uses the existing Release Please manifest and configuration on pushes to `main`.
- Dependabot groups weekly minor and patch updates for npm and GitHub Actions and targets `dev`.
- Issue forms cover bugs, feature requests, and remediation of existing security alerts. New vulnerabilities are directed to private reporting.

## Check names and rulesets

The workflow/job combinations define these status-check names:

- `CI / CI`
- `CodeQL / Analyze (javascript-typescript)`
- `CodeQL / Analyze (actions)`
- `Labeler / Label pull request`
- `Release / Release Please`

The importable repository-specific rulesets are stored in `.github/rulesets/`. They add the repository's exact required CI context to `main` and `dev`, while the integration-branch ruleset applies pull-request, review, squash-only, deletion, and force-push protections to `dev`. The inherited organization ruleset remains the broader `main` baseline and must not be weakened when these files are imported.
