# Skvallerbyttan

Skvallerbyttan är Avkrokens GitHub-dashboard. Den körs som en Cloudflare Worker på `skvallerbyttan.denied.se`, använder organisationens befintliga GitHub App Gamnacke för read-only datainsamling och GitHub OAuth App Krösa-Maja för mänsklig inloggning.

## Prioritet

Dashboarden implementeras i fallande nytta:

1. **P0 — risk och leverans:** öppna Code Scanning-, Dependabot- och Secret Scanning-alerts, Actions-hälsa, öppna/stale pull requests, issues och en repo-rankning för vad som behöver uppmärksamhet först.
2. **P1 — repo-hälsa:** trafik, commit-aktivitet, språk, contributors, releases, workflows, deployments, branches och rulesets när GitHub Appens permissions tillåter det.
3. **P2 — historik och trender:** full Actions-historik, PR lead time, MTTR och längre tidsserier. GitHubs live-endpoints räcker inte för all historik (exempelvis är repository traffic begränsad till de senaste 14 dagarna), så detta steg ska använda beständig snapshot-lagring i Cloudflare.

## Säkerhetsmodell

Dashboarden är inte publik. Workern kör före alla statiska assets och kräver en giltig GitHub OAuth-session.

- **Krösa-Maja** är GitHub OAuth App för mänsklig inloggning.
- **Gamnacke** är GitHub App för dashboardens read-only GitHub-data.
- Ingen signup eller lokal kontodatabas finns.
- Tillåtna användare styrs av numeriska GitHub user IDs i `SKVALLERBYTTAN_ALLOWED_GITHUB_IDS`.
- OAuth-flödet använder `state` och PKCE S256.
- Sessionen ligger i en signerad HttpOnly/Secure/SameSite=Lax-cookie med högst 12 timmars giltighet och revalideras mot aktuell allowlist vid varje request.
- Den tillfälliga OAuth-tokenen lagras inte och återkallas efter identitetsuppslag när GitHub tillåter det.

Gamnackes privata nyckel ligger endast som Cloudflare-secret `SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY`. Installation access tokens skickas aldrig till klienten. Secret Scanning-data reduceras till counts och secret-typer; själva secret-värdet returneras aldrig av dashboard-API:t.

Krösa-Majas OAuth Client Secret ligger endast som Cloudflare-secret `SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET`. Sessionsignering använder endast Cloudflare-secret `SKVALLERBYTTAN_SESSION_SECRET`.

Om Gamnacke saknar read-permission för en endpoint returnerar dashboarden den kapabiliteten som otillgänglig utan att övrig statistik faller.

## Runtime

- Cloudflare Worker: `src/worker.ts`
- OAuth och sessionsauth: `src/auth.ts`
- GitHub App-auth och API-klient: `src/github.ts`
- Aggregering och repo-detaljer: `src/data.ts`
- Rena metrics-funktioner: `src/metrics.ts`
- Frontend: `public/`
- Worker-konfiguration: `wrangler.jsonc`
- Produktion: Cloudflare Workers Builds från `main`

`/healthz` är en enkel process-health endpoint. `/ready` verifierar att obligatorisk Gamnacke-, Krösa-Maja- och sessionskonfiguration finns.

OAuth callback för Krösa-Maja ska vara exakt:

```text
https://skvallerbyttan.denied.se/auth/github/callback
```

## GitHub App permissions

Basdata kräver Metadata read. Fler sektioner blir tillgängliga när Gamnacke har motsvarande read-permissions, bland annat Actions, Administration (repository traffic), Code scanning alerts / Security events, Dependabot alerts och Secret scanning alerts.

Dashboarden ska degradera läsbart vid 403/404 i stället för att anta att en permission finns.

## Lokalt

```sh
npm ci
npm run check
```

För lokal Worker-körning lägg secrets i `.dev.vars` och committa aldrig filen:

```text
SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY="..."
SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET="..."
SKVALLERBYTTAN_SESSION_SECRET="..."
```

Icke-hemliga Client IDs, organisation och GitHub user-ID-allowlist ligger i `wrangler.jsonc`.

## Deploy

Normal produktionsdeploy ägs av Cloudflare Workers Builds efter merge till `main`. `npm run deploy` är Wrangler-deploykommandot och `npm run verify:production` verifierar `/ready`.
