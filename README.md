# Skvallerbyttan

Skvallerbyttan är Avkrokens centrala mottagare och reconcilerare för GitHub-säkerhetsalerts. Den skapar och underhåller säkerhets-Issues från organisationens Code Scanning-, Dependabot- och Secret Scanning-alerts.

README beskriver nuvarande design. När dokumentation och faktisk runtime skiljer sig ska `src/worker.ts`, `src/index.ts`, `wrangler.jsonc` och live GitHub-/Cloudflare-konfiguration verifieras först.

## Alert-ingestion

`POST https://skvallerbyttan.denied.se/webhook` tar emot organisationens GitHub-webhooks för `code_scanning_alert`, `dependabot_alert` och `secret_scanning_alert`.

`src/worker.ts` äger webhookens yttre säkerhetsgräns. Webhook-body begränsas innan hela payloaden buffras, `X-Hub-Signature-256` verifieras före kärnlogiken och signerade deliveries med `X-GitHub-Delivery` dedupliceras persistent via Durable Object storage. Alert→Issue-operationer använder samma persistenta idempotenslager.

Medium, High och Critical Code Scanning-/Dependabot-fynd skapar normalt Issues; Dependabot malware inkluderas alltid. Secret Scanning-fynd skapar Issues utan att själva secret-värdet kopieras till Issue eller e-post.

Issues dedupliceras med stabila `skvallerbyttan-alert:*`-markörer. Alert-state är auktoritativ: verifierat fixed/resolved stänger motsvarande Issue, medan ett fortfarande öppet alert kan återöppna ett för tidigt stängt Issue. Dismissed state behandlas inte som verifierad remediation.

## Health och readiness

- `GET /health` och `GET /` är liveness.
- `GET /ready` är readiness och returnerar `200` endast när nödvändiga secrets, vars och Worker-bindings finns.

Readiness gör avsiktligt ingen GitHub-API-förfrågan.

## Backfill och reconciliation

Cloudflare Workern kör organization-wide backfill/reconciliation enligt `wrangler.jsonc`. Workern äger alert-ingestion, Issue-skapande och alert-state-reconciliation. Den skapar inte remediation-branches, pull requests, auto-merge eller AI-delegeringar.

Alert-backfill läser GitHubs centrala alert-API. Per-repository Code Scanning-snapshotfiler behövs därför inte som separat datakälla.

## GitHub Actions

Repositoryts Actions-lager är avsiktligt litet:

- `.github/workflows/ci.yml` producerar `CI / required` och kör `npm ci` följt av `npm run check`.
- `.github/workflows/osv-scanner.yml` kör repo-lokal OSV-skanning och producerar PR-context `scan-pr / osv-scan`.

GitHub Actions skapar eller uppdaterar inte branches/PR:er i andra repositories, armerar inte auto-merge, kör inte PR-maintenance och fungerar inte som central remediation-dispatcher.

Organisationens live-ruleset `main` refererar fortfarande till Regelverkets OSV-workflow som central required workflow. Den referensen är org-level state och måste tas bort separat för att hela organisationen ska bli fullständigt repo-specifik.

## Production deploy

Cloudflare Workers Builds är enda normala produktionsdeploykedjan från `main`. GitHub Actions validerar före merge men deployar inte produktion.

Production trigger ska använda branch `main`, repository-root `/`, tomt build command, avstängda non-production branch builds och deploy command `npm run deploy && npm run verify:production`.

`npm run deploy` är direkt `wrangler deploy --strict`. Durable Object-migrationerna ligger nativt i `wrangler.jsonc`. `npm run verify:production` kontrollerar `https://skvallerbyttan.denied.se/ready` efter deploy.

`wrangler.jsonc` är source of truth för bindings, custom domain, cron, Durable Object-migrationer och observability. `workers_dev` och `preview_urls` ska vara explicit avstängda om inte en senare ändring avsiktligt ändrar policyn.

## GitHub App

Gamnacken används av Worker-runtime för GitHub API-åtkomst. Workern bygger ett App-JWT med `SKVALLERBYTTAN_CLIENT_ID`, löser installationen på `Avkroken` och byter därefter till ett kortlivat installation access token.

Runtime-konfiguration omfattar bland annat `SKVALLERBYTTAN_WEBHOOK_SECRET`, `SKVALLERBYTTAN_CLIENT_ID`, `SKVALLERBYTTAN_APP_PRIVATE_KEY`, e-postkonfiguration samt Durable Object-bindingen `SKVALLERBYTTAN_ISSUE_LOCK`.

Secrets, privata nycklar och detekterade secret-värden får aldrig committas eller loggas.
