# Skvallerbyttan

Skvallerbyttan är Avkrokens centrala mottagare och reconcilerare för GitHub-säkerhetsalerts. Den skapar och underhåller säkerhets-Issues från organisationens Code Scanning-, Dependabot- och Secret Scanning-alerts och använder en separat GitHub Actions-dispatcher för automatisk Codex-remediation.

README beskriver nuvarande design. När dokumentation och faktisk runtime skiljer sig är `src/index.ts`, `wrangler.jsonc`, live GitHub-rulesets och GitHub App-/Actions-konfigurationen de källor som ska verifieras först.

## Alert-ingestion

`POST https://skvallerbyttan.denied.se/webhook` tar emot organisationens GitHub-webhooks för:

- `code_scanning_alert`
- `dependabot_alert`
- `secret_scanning_alert`

Webhook-signaturen `X-Hub-Signature-256` verifieras innan payloaden behandlas. Medium, High och Critical Code Scanning-/Dependabot-fynd skapar Issues; Dependabot malware inkluderas alltid. Secret Scanning-fynd skapar Issues utan att själva secret-värdet kopieras till Issue eller e-post.

Issues dedupliceras med stabila `skvallerbyttan-alert:*`-markörer. Alert-state är auktoritativ: verifierat fixed/resolved stänger motsvarande Issue, medan ett fortfarande öppet alert kan återöppna ett för tidigt stängt Issue. Dismissed state behandlas inte som verifierad remediation.

Nya och befintliga öppna security-Issues tilldelas normalt `blixten85`. `Avkroken/produkter` är fortfarande explicit undantaget från automatisk assignment i Worker-koden; ändra det kontraktet i runtime-koden, inte i workflowkonfiguration, när pausen ska hävas.

## Backfill och Worker-kö

Cloudflare Workern kör organisation-wide backfill/reconciliation enligt `wrangler.jsonc`. Den kan dessutom lägga en kömarkör på öppna security-Issues. Worker-kön skapar inte branches, pull requests eller Codex-delegeringskommentarer och är inte den GitHub-side writer som genomför remediation.

Per-repository Code Scanning-snapshotfiler behövs inte: Workern läser GitHubs centrala alert-API direkt.

## Automatisk Codex-remediation

`.github/workflows/codex-security-dispatch.yml` är den enda GitHub-side dispatcher som får skapa automatiska remediation-branches och PR:er.

Flödet är:

1. Dispatchern kör på `main`, manuellt och var femte minut.
2. Den söker öppna `skvallerbyttan-alert:*`-Issues i organisationen och tillåter högst en aktiv remediation per repository.
3. Om `CODEX_TRIGGER_TOKEN` saknas eller inte autentiserar som `CODEX_TRIGGER_LOGIN` skapas ingen branch eller seed-PR. Flödet failar stängt.
4. En ny remediation får en körningsunik branch `automation/codex-issue/<issue>-<run>-<attempt>` från repositoryts aktuella default branch.
5. En tillfällig `.github/codex-dispatch/issue-<number>.md` skapas och PR:n öppnas som draft utan auto-merge.
6. `@codex`-kommentaren skrivs med den verifierade användarcredentialen. Bot-skrivna mentions används inte som delegationsmekanism.
7. Så länge seed-filen finns kvar, eller PR:n saknar verkliga filändringar, hålls PR:n draft och auto-merge avstängd.
8. När seed-filen är borta och en verklig fix finns markeras PR:n ready och squash auto-merge armeras. Required CI och review-thread-resolution i målrepositoryt fortsätter blockera merge.
9. Om GitHub vägrar armera auto-merge, exempelvis därför att PR:n redan är `clean`, lämnas PR:n öppen med en blockeringskommentar. Dispatchern gör aldrig direkt merge som fallback.

Repository-lokala branchpooler, `sync-pool`, PR-watchdogs och remediation-bridge-workflows ingår inte längre i den här modellen.

## GitHub Actions

Repositoryts live-ruleset kräver exakt status context `CI / required`.

`.github/workflows/ci.yml` kör:

- kontroll att ingen tillfällig Codex seed-fil finns kvar,
- `npm ci`,
- `npm test`,
- `npm run typecheck`,
- `npm run validate:bindings`.

`.github/workflows/osv-scanner.yml` kör kompletterande OSV-skanning för PR, `main` och schemalagd kontroll. OSV är inte en required context i live-rulesetet.

Live `main`-rulesetet kräver också lösta review-trådar och tillåter endast squash merge. Repositoryt använder inte merge queue.

## GitHub App

Gamnacken används för GitHub API-åtkomst. Workern bygger ett App-JWT med `SKVALLERBYTTAN_CLIENT_ID`, verifierar App-identiteten, löser installationen på `Avkroken` och byter därefter till ett kortlivat installation access token.

Worker-konfiguration:

- `SKVALLERBYTTAN_WEBHOOK_SECRET` — secret för organization-webhookens HMAC-signatur.
- `SKVALLERBYTTAN_CLIENT_ID` — Gamnackens GitHub App Client ID.
- `SKVALLERBYTTAN_APP_PRIVATE_KEY` — GitHub App private key; PKCS#1 och PKCS#8 stöds.
- `SKVALLERBYTTAN_EMAIL_TO` — destination för Secret Scanning-notiser.
- `SKVALLERBYTTAN_EMAIL_FROM` — avsändare för Secret Scanning-notiser.
- `EMAIL` — Cloudflare Send Email-binding.
- `SKVALLERBYTTAN_ISSUE_LOCK` — Durable Object-binding som serialiserar Issue-skapande.

GitHub Actions-dispatchern använder dessutom:

- `GAMNACKEN_ID` — repository/organization variable för App-token-steget.
- `GAMNACKEN_PEMKEY` — secret för App-token-steget.
- `CODEX_TRIGGER_TOKEN` — användarcredential som endast används för den användar-authenticated `@codex`-kommentaren.
- `CODEX_TRIGGER_LOGIN` — förväntad login för den credentialen, default `blixten85`.

Secrets, privata nycklar och detekterade secret-värden får aldrig committas eller loggas.
