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

## GitHub-styrning

- Kanonisk arbets- och reviewpolicy finns i `Avkroken/.github/AGENTS.md`.
- `main` ärvs från organisationens gemensamma `main`-ruleset; organisationsbaslinjen versionshanteras centralt i `Avkroken/.github`.
- Repo-specifika required checks läggs först till efter att de valda starter-workflows faktiskt har producerat och verifierat checknamnen. Se `.github/rulesets/starter-workflows-analysis.md`.
- GitHubs CodeQL default setup är aktivt för repositoryt; ingen lokal Advanced CodeQL-workflow läggs till.
- `dev` är integrationsgren när ett aktivt `dev-pilot`-ruleset finns. Lägg endast required status checks på `dev` när workflows bevisligen producerar exakt de check-namnen för PR mot `dev`.
- Organisationens CodeRabbit-UI är baslinje. Repository-lokal `.coderabbit.yaml` ska endast användas för uttryckligen repo-specifika overrides.

## Starter-workflows

Repositoryts lokala GitHub Actions ska endast använda passande mallar från `actions/starter-workflows`. Den aktuella arbetsbranchen använder Node.js CI och Dependency review. Dependabot-konfigurationen följer starter-repositoryts npm- och GitHub Actions-upplägg.

Den tidigare egna `npm run check`-gaten omfattade även TypeScript typecheck och Wrangler dry-run. Dessa delar saknar en direkt starter-workflow-motsvarighet inom den valda Node-mallen och dokumenteras som täckningsgap i stället för att återinföras som egna workflow-steg.

## Validering

Kör `npm run check` lokalt för relevanta kodändringar och kontrollera att inga credential- eller secret-payloads introduceras.
