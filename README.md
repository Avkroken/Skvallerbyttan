# Skvallerbyttan

Skvallerbyttan är Avkrokens GitHub-dashboard. Den körs som en Cloudflare Worker på `skvallerbyttan.denied.se`, använder organisationens befintliga GitHub App för read-only datainsamling och visar organisationsöversikt samt repo-specifik statistik.

## Prioritet

Dashboarden implementeras i fallande nytta:

1. **P0 — risk och leverans:** öppna Code Scanning-, Dependabot- och Secret Scanning-alerts, Actions-hälsa, öppna/stale pull requests, issues och en repo-rankning för vad som behöver uppmärksamhet först.
2. **P1 — repo-hälsa:** trafik, commit-aktivitet, språk, contributors, releases, workflows, deployments, branches och rulesets när GitHub Appens permissions tillåter det.
3. **P2 — historik och trender:** full Actions-historik, PR lead time, MTTR och längre tidsserier. GitHubs live-endpoints räcker inte för all historik (exempelvis är repository traffic begränsad till de senaste 14 dagarna), så detta steg ska använda beständig snapshot-lagring i Cloudflare.

## Säkerhetsmodell

Dashboarden är inte publik. Workern kör före alla statiska assets och kräver HTTP Basic-auth. Användarnamnet ligger i `wrangler.jsonc`; lösenordet ligger endast som Cloudflare-secret `SKVALLERBYTTAN_DASHBOARD_PASSWORD`.

GitHub Appens privata nyckel ligger endast som Cloudflare-secret `SKVALLERBYTTAN_APP_PRIVATE_KEY`. Installation access tokens skickas aldrig till klienten. Secret Scanning-data reduceras till counts och secret-typer; själva secret-värdet returneras aldrig av dashboard-API:t.

Om GitHub Appen saknar read-permission för en endpoint returnerar dashboarden den kapabiliteten som otillgänglig utan att övrig statistik faller.

## Runtime

- Cloudflare Worker: `src/worker.ts`
- GitHub App-auth och API-klient: `src/github.ts`
- Aggregering och repo-detaljer: `src/data.ts`
- Rena metrics-funktioner: `src/metrics.ts`
- Frontend: `public/`
- Worker-konfiguration: `wrangler.jsonc`
- Produktion: Cloudflare Workers Builds från `main`

`/healthz` är en enkel process-health endpoint. `/ready` verifierar att obligatorisk GitHub App-konfiguration och dashboard-lösenord finns.

## GitHub App permissions

Basdata kräver Metadata read. Fler sektioner blir tillgängliga när appen har motsvarande read-permissions, bland annat Actions, Administration (repository traffic), Code scanning alerts / Security events, Dependabot alerts och Secret scanning alerts.

Dashboarden ska degradera läsbart vid 403/404 i stället för att anta att en permission finns.

## Lokalt

```sh
npm ci
npm run check
```

För lokal Worker-körning lägg secrets i `.dev.vars` och committa aldrig filen:

```text
SKVALLERBYTTAN_APP_PRIVATE_KEY="..."
SKVALLERBYTTAN_DASHBOARD_PASSWORD="..."
```

## Deploy

Normal produktionsdeploy ägs av Cloudflare Workers Builds efter merge till `main`. `npm run deploy` är fortfarande den deklarerade Wrangler-deploykommandot och `npm run verify:production` verifierar `/ready`.
