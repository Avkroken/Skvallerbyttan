# Starter workflow-analys för rulesets

## Källor
- `actions/starter-workflows/ci/node.js.yml`
- `actions/starter-workflows/code-scanning/codeql.yml`
- `actions/starter-workflows/code-scanning/dependency-review.yml`
- `actions/starter-workflows/code-scanning/osv-scanner.yml`
- `actions/starter-workflows/.github/dependabot.yml`

## Checks som produceras av mallarna

- `Node.js CI` med `build`-jobb och matrix `22.x`, `24.x` ger checks:
  - `Node.js CI / build (22.x)`
  - `Node.js CI / build (24.x)`
- `CodeQL Advanced` med språk `javascript-typescript` ger check:
  - `CodeQL Advanced / Analyze (javascript-typescript)`
- `Dependency review` ger check:
  - `Dependency review / dependency-review`
- `OSV-Scanner` ger PR-check:
  - `OSV-Scanner / scan-pr`

## Det som saknar standardmall i starter-workflows

- Issue-mall specifikt för security alerts: saknas.
- PR-mall specifikt för security alerts: saknas.
- Release-workflow för detta repo-flöde: saknas.

Dessa delar dokumenteras här och ersätts inte med egna workflows eller egna security-alert-mallar.
