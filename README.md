# Skvallerbyttan

Skvallerbyttan är Avkrokens GitHub-dashboard. Den körs som en Cloudflare Worker på `skvallerbyttan.denied.se`, använder Gamnacke som GitHub App för read-only datainsamling och Krösa-Maja som GitHub OAuth App för mänsklig inloggning.

## Prioritet

Dashboarden implementeras i fallande nytta:

1. **P0 — risk och leverans:** öppna Code Scanning-, Dependabot- och Secret Scanning-alerts, Actions-hälsa, öppna/stale pull requests, issues och en repo-rankning för vad som behöver uppmärksamhet först.
2. **P1 — repo-hälsa:** trafik, commit-aktivitet, språk, contributors, releases, workflows, deployments, branches och rulesets när GitHub Appens permissions tillåter det.
3. **P2 — historik och trender:** full Actions-historik, PR lead time, MTTR och längre tidsserier. GitHubs live-endpoints räcker inte för all historik (exempelvis är repository traffic begränsad till de senaste 14 dagarna), så detta steg ska använda beständig snapshot-lagring i Cloudflare.

## Säkerhetsmodell

Dashboarden är inte publik. Workern kör före dashboardens statiska assets och `/api/*`.

Mänsklig inloggning går via Krösa-Maja som GitHub OAuth App. Skvallerbyttan har ingen signup och skapar inga egna användarkonton. Efter OAuth-callback hämtas GitHub-användarens numeriska ID och jämförs med den explicita allowlisten `SKVALLERBYTTAN_ALLOWED_GITHUB_IDS` i `wrangler.jsonc`.

OAuth-flödet använder `state` och PKCE. GitHub-tokenen används endast för identitetsuppslaget och lagras inte. Workern försöker dessutom återkalla tokenen direkt efter uppslaget.

En lyckad inloggning ger en signerad `HttpOnly`, `Secure`, `SameSite=Lax` sessionscookie. Sessionen är stateless, gäller i högst 12 timmar och verifieras mot aktuell allowlist vid varje request. Ingen D1- eller KV-lagring behövs för login. Rotation av `SKVALLERBYTTAN_SESSION_SECRET` gör befintliga sessioner ogiltiga direkt.

Krösa-Majas Client Secret ligger endast som Cloudflare-secret `SKVALLERBYTTAN_KROSA_MAJA_CLIENT_SECRET`. Sessionsnyckeln ligger endast som `SKVALLERBYTTAN_SESSION_SECRET`.

Gamnacke används separat för dashboardens GitHub API-data. Dess privata nyckel ligger endast som Cloudflare-secret `SKVALLERBYTTAN_GAMNACKE_PRIVATE_KEY`. Installation access tokens skickas aldrig till klienten. Secret Scanning-data reduceras till counts och secret-typer; själva secret-värdet returneras aldrig av dashboard-API:t.

Om Gamnacke saknar read-permission för en endpoint returnerar dashboarden den kapabiliteten som otillgänglig utan att övrig statistik faller.

## OAuth-konfiguration

Krösa-Majas OAuth App ska ha callback-URL:

```text
https://skvallerbyttan.denied.se/auth/github/callback
```

Krösa-Majas Client ID är inte hemligt och ligger som `SKVALLERBYTTAN_KROSA_MAJA_CLIENT_ID` i `wrangler.jsonc`. Client Secret får aldrig committas.

Tillåtna GitHub-konton anges med numeriska GitHub user IDs i `SKVALLERBYTTAN_ALLOWED_GITHUB_IDS`, separerade med kommatecken. Använd inte GitHub-login som långsiktig identitetsnyckel eftersom login-namn kan bytas.

## Runtime

- HTTP-gräns, routing och cache: `src/worker.ts`
- OAuth och sessionsverifiering: `src/auth.ts`
- Gamnacke GitHub App-auth och API-klient: `src/github.ts`
- Aggregering och repo-detaljer: `src/data.ts`
- Rena metrics-funktioner: `src/metrics.ts`
- Frontend: `public/`
- Worker-konfiguration: `wrangler.jsonc`
- Produktion: Cloudflare Workers Builds från `main`

`/healthz` är en enkel process-health endpoint. `/ready` verifierar att obligatorisk Gamnacke-, Krösa-Maja-, session- och allowlist-konfiguration finns. `/ready` gör inte ett live-anrop till GitHub.

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

## Deploy

Normal produktionsdeploy ägs av Cloudflare Workers Builds efter merge till `main`. `npm run deploy` är den deklarerade Wrangler-deploykommandot och `npm run verify:production` verifierar `/ready`.
