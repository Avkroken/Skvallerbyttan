# Skvallerbyttan

Repositoryt underhålls av Avkroken.

## GitHub webhook

Dashboardens cache är webhook-first. GitHub-aktivitet invaliderar bara berörd cache och nästa läsning uppdaterar den i bakgrunden. En full overview-reconciliation körs var sjätte timme som säkerhetsnät.

GitHub Appens webhook ska använda:

- URL: `https://skvallerbyttan.denied.se/webhooks/github`
- Content type: `application/json`
- Secret: samma värde som Worker-secreten `SKVALLERBYTTAN_WEBHOOK_SECRET`
- SSL verification: på

Prenumerera bara på de events dashboarden använder: `branch_protection_rule`, `check_run`, `check_suite`, `code_scanning_alert`, `create`, `delete`, `dependabot_alert`, `deployment`, `deployment_status`, `fork`, `issues`, `pull_request`, `pull_request_review`, `pull_request_review_comment`, `push`, `release`, `repository`, `repository_ruleset`, `secret_scanning_alert`, `secret_scanning_alert_location`, `star`, `status`, `workflow_job` och `workflow_run`.

Webhook-signaturen verifieras med `X-Hub-Signature-256`, leveranser dedupliceras med `X-GitHub-Delivery`, och events från andra organisationer ignoreras.

## Issues

Använd GitHub Issues för reproducerbara fel eller förbättringsförslag. Mallarna i `.github/ISSUE_TEMPLATE/` används för nya ärenden.

## Säkerhet

Rapportera inte sårbarheter eller hemligheter i publika issues. Följ [SECURITY.md](SECURITY.md) för privat rapportering.

## Finansiering

GitHub Sponsors-konfigurationen finns i `.github/FUNDING.yml`.
