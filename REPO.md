# REPO.md

`Skvallerbyttan` är Avkrokens autentiserade GitHub-statistikdashboard som körs som Cloudflare Worker med D1-historik.

## Invarians

- Dashboard-data, assets och `/api/*` ska förbli autentiserade. Publika auth-endpoints får inte exponera dashboard-data.
- GitHub App-private keys, installation tokens, OAuth/session-hemligheter och Secret Scanning-värden får inte committas, loggas, lagras i D1 eller skickas till klienter.
- OAuth-användartoken används endast för identitetsuppslag vid login och ska inte sparas.
- Åtkomst binds till numeriska GitHub user IDs, inte föränderliga login-namn.
- Statistikinsamling använder minsta nödvändiga läsbehörighet och ska inte lägga till skrivoperationer mot andra förråd.
- `src/metrics.ts` ska förbli ren och testbar utan nätverksanrop. Samplade, trunkerade eller härledda mätvärden ska identifieras som sådana.
- `wrangler.jsonc` är källa till sanning för versionshanterad Worker-konfiguration.
- Produktionsdistribution från `main` hanteras av Cloudflare Workers Builds.

## Validering

Kör `npm run check` för relevanta ändringar och kontrollera att inga credential- eller secret-payloads introduceras.
