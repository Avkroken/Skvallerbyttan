# Skvallerbyttan

Skvallerbyttan är Avkrokens centrala mottagare och reconcilerare för GitHub-säkerhetsalerts. Den skapar och underhåller säkerhets-Issues från organisationens Code Scanning-, Dependabot- och Secret Scanning-alerts och använder en separat GitHub Actions-dispatcher för automatisk Codex-remediation.

README beskriver nuvarande design. När dokumentation och faktisk runtime skiljer sig är `src/worker.ts`, `src/index.ts`, `wrangler.jsonc`, live GitHub-rulesets och GitHub App-/Actions-konfigurationen de källor som ska verifieras först.

## Alert-ingestion

`POST https://skvallerbyttan.denied.se/webhook` tar emot organisationens GitHub-webhooks för:

- `code_scanning_alert`
- `dependabot_alert`
- `secret_scanning_alert`

`src/worker.ts` äger webhookens yttre säkerhetsgräns. Webhook-body läses streamat och avbryts när den överskrider 1 MiB, innan en för stor payload buffras färdigt. Därefter verifieras `X-Hub-Signature-256` en gång innan den verifierade payloaden lämnas till kärnlogiken. Signerade deliveries med `X-GitHub-Delivery` dedupliceras persistent via Durable Object storage, och alert→Issue-operationer använder samma persistenta idempotenslager.

Medium, High och Critical Code Scanning-/Dependabot-fynd skapar normalt Issues; Dependabot malware inkluderas alltid. Ett avgränsat observability-only-undantag gäller Trivy-regeln `OsPackageVulnerability` i `Avkroken/Produkter` och `Avkroken/Docker-idempotent-update`: dessa repositories rapporterar avsiktligt hela OS-baselinen till Code Scanning och har separata baseline-vs-PR-gates som blockerar nya HIGH/CRITICAL-regressioner. Alerts förblir därför öppna och synliga i Code Scanning men dupliceras inte som separata remediation-Issues. CodeQL, andra Trivy-regler/verktyg och alla andra repositories följer normal Issue-policy. Secret Scanning-fynd skapar Issues utan att själva secret-värdet kopieras till Issue eller e-post. För nya eller återöppnade Secret Scanning-alerts ingår även e-postleveransen i webhookens framgångsvillkor: ett temporärt e-postfel ger 5xx och delivery-leasen släpps så GitHub kan försöka webhooken igen utan att skapa ett duplicerat Issue.

Issues dedupliceras med stabila `skvallerbyttan-alert:*`-markörer. Alert-state är auktoritativ: verifierat fixed/resolved stänger motsvarande Issue, medan ett fortfarande öppet alert kan återöppna ett för tidigt stängt Issue. Dismissed state behandlas inte som verifierad remediation. För observability-only-undantagen ovan stänger reconciliation ett eventuellt äldre duplicerat Issue som `not_planned` utan att ändra eller dismiss:a själva Code Scanning-alerten.

Nya och befintliga öppna security-Issues tilldelas normalt `blixten85`. `Avkroken/produkter` är explicit undantaget från automatisk assignment i Worker-koden.

## Health och readiness

- `GET /health` och `GET /` är liveness: de visar att Worker-processen svarar.
- `GET /ready` är readiness: den returnerar `200` endast när nödvändiga secrets, vars och Worker-bindings finns; annars `503`.

Readiness gör avsiktligt ingen GitHub-API-förfrågan, så probes skapar inte extern API-last eller en ny felkälla.

## Backfill och reconciliation

Cloudflare Workern kör organization-wide backfill/reconciliation enligt `wrangler.jsonc`. Workern äger alert-ingestion, Issue-skapande och alert-state-reconciliation. Den skapar inte remediation-branches, pull requests eller Codex-delegeringar.

Alert-backfill läser GitHubs centrala alert-API. Issue-reconciliation listar organisationens aktiva repositories och paginerar respektive repositorys Issues, vilket undviker GitHub Searchs globala 1 000-resultatsfönster. Per-repository Code Scanning-snapshotfiler behövs därför inte som separat datakälla.

## Automatisk Codex-remediation

`.github/workflows/codex-security-dispatch.yml` är den enda automatiska workflow-dispatcher som får skapa remediation-branches och PR:er. Workflowen håller orchestration, credentials och permissions deklarativa och laddar implementationen från `.github/scripts/codex-security-dispatch.cjs`. Alert-scope-policyn ligger separat i `.github/scripts/remediation-scope.cjs`.

Flödet är:

1. Dispatchern kör på `main`, manuellt och var femte minut.
2. Den söker öppna `skvallerbyttan-alert:*`-Issues i organisationen och tillåter högst en aktiv remediation per repository.
3. Om `CODEX_TRIGGER_TOKEN` saknas eller inte autentiserar som `CODEX_TRIGGER_LOGIN` skapas ingen branch eller seed-PR. Flödet failar stängt.
4. En ny remediation får en körningsunik branch `automation/codex-issue/<issue>-<run>-<attempt>` från repositoryts aktuella default branch.
5. En tillfällig `.github/codex-dispatch/issue-<number>.md` skapas och PR:n öppnas som draft utan auto-merge.
6. `@codex`-kommentaren skrivs med den verifierade användarcredentialen. Bot-skrivna mentions används inte som delegationsmekanism.
7. Så länge seed-filen finns kvar, eller PR:n saknar verkliga filändringar, hålls PR:n draft och auto-merge avstängd.
8. Innan ready/auto-merge verifierar dispatchern den ursprungliga GitHub-alerten. Alerten måste fortfarande vara öppen och PR:n måste ändra alert-relevant path: Code Scanning source path, Dependabot manifest/relevant lockfile eller verifierad Secret Scanning commit-location. Oförifierbar scope eller API-/permissionfel failar stängt och håller PR:n draft.
9. När scope-gaten är uppfylld och målrepositoryts obligatoriska merge-gates är verifierade för aktuell HEAD markeras PR:n ready och squash auto-merge kan armeras.
10. Om GitHub vägrar armera auto-merge lämnas PR:n öppen med en blockeringskommentar. Dispatchern gör aldrig direkt merge som fallback.

Repository-lokala branchpooler, `sync-pool`, PR-watchdogs och remediation-bridge-workflows ingår inte längre i den här modellen.

## Production deploy

Cloudflare Workers Builds är enda normala produktionsdeploykedjan från `main`. GitHub Actions validerar före merge men deployar inte produktion.

Production trigger ska använda:

- Production branch: `main`
- Root directory: `/`
- Build command: tomt
- Non-production branch builds: avstängt
- Deploy command: `npm run deploy && npm run verify:production`
- Build watch paths: `src/**`, `scripts/verify-production.mjs`, `wrangler.jsonc`, `package.json`, `package-lock.json`, `tsconfig.json`

`npm run deploy` är direkt `wrangler deploy --strict`. Durable Object-migrationerna ligger nativt i `wrangler.jsonc` och följer Worker-deployen; det finns ingen separat migrationswrapper.

`npm run verify:production` kontrollerar `https://skvallerbyttan.denied.se/ready` och kräver HTTP 200 samt exakt readiness-payload `{ "ok": true, "service": "skvallerbyttan", "check": "configuration" }`. Readiness verifierar därmed att nödvändiga secrets, vars, Send Email-binding och Durable Object-binding finns utan att anropa GitHub API.

Det finns ingen repo-lokal deployorkestrerare och ingen duplicerad Workers Builds branch/SHA-logik. Production branch, root directory, watch paths och kommandosekvens ägs av Cloudflare Workers Builds. `wrangler.jsonc` är source of truth för bindings, custom domain, cron, Durable Object-migrationer och observability. `workers_dev` och `preview_urls` är explicit avstängda så produktion bara exponeras via den deklarerade custom domainen.

## GitHub Actions och merge-enforcement

Live-rulesetet `main-enforcement` gäller default branch `main` och kräver exakt två status contexts:

- `CI / required`
- `scan-pr / osv-scan`

Required status checks använder strict latest-base enforcement (`strict_required_status_checks_policy: true`), så den verifierade PR-HEAD:en måste vara kompatibel med aktuell `main`.

`.github/workflows/ci.yml` producerar `CI / required` och kör:

- kontroll att ingen tillfällig Codex seed-fil finns kvar,
- `npm ci`,
- `npm test`,
- `npm run typecheck`,
- `npm run validate:bindings`,
- `npm run validate:worker` (`wrangler deploy --dry-run`).

`.github/workflows/osv-scanner.yml` producerar PR-context `scan-pr / osv-scan`. Den pinnade OSV reusable PR-scannern kör på varje PR mot `main` och failar på nya sårbarheter. `scan-main` fortsätter som kompletterande scanning på `main`, schema och manuell körning men är inte en required PR-context.

CodeQL verkställs genom GitHub Code Scanning merge protection, separat från required status checks. Tool-namnet är `CodeQL`; security alerts från `medium_or_higher` blockerar merge och CodeQL alerts på nivåerna `errors_and_warnings` blockerar merge.

Review- och merge-policyn är:

- 0 generella approvals och ingen last-push-approval,
- alla relevanta review-trådar måste vara resolved,
- Copilot Code Review har `review_on_push: true` men är rådgivande och inte en hard gate,
- CodeRabbit är best effort och inte en required status check; quota, rate limit eller tillfälligt reviewfel blockerar inte ensamt merge,
- faktiska CodeRabbit- och Copilot-findings ska fortfarande utvärderas och relevanta review-trådar lösas först efter verifierad fix,
- deletion och non-fast-forward/force push till `main` blockeras,
- inga bypass actors finns,
- endast squash merge är tillåten,
- repositoryt använder inte merge queue.

`.coderabbit.yaml` använder CodeRabbit inheritance, commit-statusrapportering, `fail_commit_status: true`, automatisk incremental review på nya pushes och `auto_pause_after_reviewed_commits: 0`. CodeRabbit-status är en observationssignal, inte ett mergevillkor.

Auto-merge ska inte armeras förrän live-rulesetet är verifierat och de obligatoriska gates som gäller aktuell HEAD är identifierade. Efter en ny push måste aktuell HEAD och dess required CI/security-resultat samt review-trådar kontrolleras igen.

## GitHub App

Gamnacken används för GitHub API-åtkomst. Workern bygger ett App-JWT med `SKVALLERBYTTAN_CLIENT_ID`, verifierar App-identiteten, löser installationen på `Avkroken` och byter därefter till ett kortlivat installation access token.

Worker-konfiguration:

- `SKVALLERBYTTAN_WEBHOOK_SECRET` — secret för organization-webhookens HMAC-signatur.
- `SKVALLERBYTTAN_CLIENT_ID` — Gamnackens GitHub App Client ID.
- `SKVALLERBYTTAN_APP_PRIVATE_KEY` — GitHub App private key; PKCS#1 och PKCS#8 stöds.
- `SKVALLERBYTTAN_EMAIL_TO` — destination för Secret Scanning-notiser.
- `SKVALLERBYTTAN_EMAIL_FROM` — avsändare för Secret Scanning-notiser.
- `EMAIL` — Cloudflare Send Email-binding.
- `SKVALLERBYTTAN_ISSUE_LOCK` — Durable Object-binding för persistent delivery- och Issue-idempotens.

GitHub Actions-dispatchern använder dessutom:

- `GAMNACKEN_ID` — repository/organization variable för App-token-steget.
- `GAMNACKEN_PEMKEY` — secret för App-token-steget.
- `CODEX_TRIGGER_TOKEN` — användarcredential som endast används för den användar-authenticated `@codex`-kommentaren.
- `CODEX_TRIGGER_LOGIN` — förväntad login för den credentialen, default `blixten85`.

Secrets, privata nycklar och detekterade secret-värden får aldrig committas eller loggas.
