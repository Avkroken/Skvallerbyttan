# AGENTS.md

Den här filen är repositoryts auktoritativa arbetsinstruktion. Live GitHub-konfiguration och aktiva rulesets är verkställande sanning om dokumentation och faktisk enforcement skiljer sig.

## Repository

`Skvallerbyttan` är Avkrokens GitHub-statistikdashboard.

- `src/worker.ts` äger HTTP-gräns, auth-gating, caching och statiska assets.
- `src/auth.ts` äger Krösa-Maja OAuth, PKCE/state, allowlist och signerade sessionscookies.
- `src/github.ts` äger Gamnacke GitHub App JWT, installation token och GitHub REST-anrop.
- `src/data.ts` äger aggregering av organisations- och repo-statistik.
- `src/metrics.ts` ska hållas ren och testbar utan nätverksanrop.
- `public/` är dashboard-klienten.
- `wrangler.jsonc` är source of truth för versionerad Worker-konfiguration och custom domain.
- Cloudflare Workers Builds äger normal produktionsdeploy från `main`.

## Brancher och pull requests

- `main` är den enda permanenta branchen och den enda branch som ska vara skyddad.
- Allt arbete sker på kortlivade feature/fix/chore-brancher skapade från aktuell `main`, till exempel `codex/{feature}`.
- Öppna PR direkt från arbetsbranchen till `main`; det finns ingen permanent `dev`-branch.
- Brancher städas automatiskt efter merge; gör ingen normal manuell branch-cleanup.
- Kringgå aldrig rulesets, required checks, reviews eller thread resolution.
- Squash är målmetoden när live-policy tillåter/kräver det.

## Dataskydd

- Gamnackes GitHub App private key, installation tokens, Krösa-Majas OAuth client secret, sessionshemlighet och andra credentials får aldrig committas, loggas eller skickas till klienten.
- OAuth-user-tokenen får endast användas för identitetsuppslag under login och får inte lagras eller skickas till klienten.
- Secret Scanning-secretvärden får aldrig returneras från API:t, renderas i UI:t eller loggas. Endast aggregerad statistik och icke-hemlig typmetadata får exponeras.
- Dashboard-data, dashboard-assets och `/api/*` ska vara autentiserade. `/login`, OAuth-callback och logout är avsiktliga publika auth-ytor och får inte exponera dashboard-data.
- Åtkomst ska bindas till numeriska GitHub user IDs i explicit allowlist; GitHub-login får inte användas som permanent identitetsnyckel.
- Nya GitHub-endpoints ska använda minsta nödvändiga read-permission och degradera tydligt vid saknad permission.
- Lägg inte till write-operationer mot andra repositories som en del av statistikinsamlingen.

## GitHub-statistik

Prioritera i denna ordning:

1. säkerhetsrisk och leveranshälsa,
2. repo-hälsa och trafik,
3. historiska trender och härledda mått.

Mått ska märkas som sample/truncated när API:t inte ger full historik. Härledda mått som attention-score får inte presenteras som GitHub-native statistik.

## Cloudflare

- `wrangler.jsonc` behåller Worker-namnet `skvallerbyttan` och custom domain `skvallerbyttan.denied.se`.
- GitHub Actions ska inte deploya produktion; Cloudflare Workers Builds gör det.
- Runtime-secrets ska hanteras i Cloudflare, inte i Git/GitHub Actions.
- `assets.run_worker_first` ska förbli aktivt så att auth inte kan kringgås via statiska assets.

## Verifiering

Före PR: kör `npm run check`, granska hela diffen mot `main` och kontrollera att inga credentials eller secret payloads har introducerats. Efter push/PR: verifiera exakt final HEAD, required checks, Code Scanning och review-trådar enligt live rulesets.

## Definition of done

En ändring är klar först när implementationen är verifierad, CI/security-gates är gröna på exakt final HEAD och den har mergats via normal enforcement, eller tydligt väntar på en legitim extern gate som Cloudflare-secret eller deploy.
