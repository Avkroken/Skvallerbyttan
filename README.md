# Skvallerbyttan

Repositoryt underhålls av Avkroken.

## GitHub webhook

Dashboardens cache är webhook-first. GitHub-aktivitet invaliderar bara berörd cache och nästa läsning uppdaterar den i bakgrunden. En full overview-reconciliation körs var sjätte timme som säkerhetsnät.

Organisationens webhook ska använda:

- URL: `https://skvallerbyttan.denied.se/webhooks/github`
- Content type: `application/json`
- Secret: samma värde som Worker-secreten `SKVALLERBYTTAN_WEBHOOK_SECRET`
- SSL verification: på

Prenumerera på de events dashboarden faktiskt använder: `code_scanning_alert`, `dependabot_alert`, `deployment`, `deployment_status`, `fork`, `issues`, `pull_request`, `pull_request_review`, `push`, `release`, `repository`, `repository_ruleset`, `secret_scanning_alert`, `star` och `workflow_run`.

Branch/tag creation och deletion behövs inte för dashboardens nuvarande statistik. `Repository vulnerability alerts`, `secret_scanning_alert_location` och `pull_request_review_comment` ska inte aktiveras förrän dashboarden faktiskt använder deras extra data.

Webhook-signaturen verifieras med `X-Hub-Signature-256`, leveranser dedupliceras med `X-GitHub-Delivery`, och events från andra organisationer ignoreras.

Code scanning-, Dependabot- och secret scanning-events skrivs dessutom till en D1-ledger. Ledgern sparar bara metadata som event, repo, alertnummer, action, severity, paket/rule/secret-typ och resolution — aldrig själva hemligheten. Dashboarden använder den för 30-dagars säkerhetsaktivitet och börjar räkna från den första webhookhändelsen efter att migrationen har applicerats.

## Issues

Använd GitHub Issues för reproducerbara fel eller förbättringsförslag. Mallarna i `.github/ISSUE_TEMPLATE/` används för nya ärenden.

## Säkerhet

Rapportera inte sårbarheter eller hemligheter i publika issues. Följ [SECURITY.md](SECURITY.md) för privat rapportering.

## Finansiering

GitHub Sponsors-konfigurationen finns i `.github/FUNDING.yml`.
