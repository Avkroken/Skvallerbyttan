# AGENTS.md

Den här filen är repositoryts auktoritativa arbetsinstruktion. Live GitHub-konfiguration och aktiva rulesets är verkställande sanning om dokumentation och faktisk enforcement skiljer sig.

## Repository

`Skvallerbyttan` är Avkrokens GitHub-statistikdashboard.

- `src/worker.ts` äger HTTP-gräns, auth-gating, caching och statiska assets.
- `src/auth.ts` äger Krösa-Maja OAuth, PKCE/state, allowlist och signerade sessionscookies.
- `src/github.ts` äger Gamnacke GitHub App JWT, installation token och GitHub REST-anrop.
- `src/data.ts` äger aggregering av organisations- och repo-statistik.
- `src/insights.ts` äger sample-baserade PR-, Actions-, deployment- och aktivitetstrender.
- `src/history.ts` äger D1-snapshots, historikfrågor och ”Sedan sist”-delta.
- `src/metrics.ts` ska hållas ren och testbar utan nätverksanrop.
- `public/` är dashboard-klienten.
- `migrations/` innehåller versionerade D1-migrationer för statistik, aldrig credentials.
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
- Secret Scanning-secretvärden får aldrig returneras från API:t, renderas i UI:t, lagras i D1 eller loggas. Endast aggregerad statistik och icke-hemlig typmetadata får exponeras.
- D1-statistikhistorik får endast innehålla aggregerade/härledda mått och icke-hemliga repo-identiteter/tidsstämplar; aldrig token, private keys eller credential payloads.
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

## Metadata-only AI triage exception

Repositoryägaren har uttryckligen godkänt metadata-only issue triage via GitHub Agentic Workflows. Detta är klassificering, inte coding-agent delegation eller remediation.

- `.github/workflows/metadata-routing.yml` får endast anropa Avkrokens centrala deterministiska metadata-routing för assignee och labels.
- `.github/workflows/issue-classification.yml` får endast trigga på öppnade/återöppnade issues, anropa den SHA-pinnade centrala `issue-classification.lock.yml` och efter lyckad klassificering anropa den SHA-pinnade centrala metadata-routingen.
- AI-delen får läsa det triggande issuet och read-only repositorykontext som behövs för klassificering.
- `gh-aw` safe outputs får endast lägga till exakt en temporär `classification:<difficulty>:<security>`-label från den centrala allowlisten. Den deterministiska routingen konverterar den till kanoniska `difficulty:*` och `security:*` labels och tar bort temporärlabeln.
- Befintliga kanoniska klassificeringslabels tar företräde över AI-output. Malformed eller konfliktande klassificeringsmetadata ska faila stängt till `triage:invalid`.
- Caller-workflowen får endast mappa `COPILOT_GITHUB_TOKEN` explicit till AI-workflowen; `secrets: inherit` är inte tillåtet.
- Workflowen får inte kommentera, assigna coding agents, skapa/ändra branches eller PR:er, reviewa, mergea, deploya, mutera statistikdata eller utföra/föreslå remediation.
- Copilot-auth får komma från organization billing eller GitHub Actions-secreten `COPILOT_GITHUB_TOKEN`. Credentialvärden får aldrig committas, loggas eller kopieras till dokumentation.

Detta undantag tillåter inte write-operationer mot andra repositories och ändrar inte dataskydds-, auth-, Cloudflare-, review- eller mergepolicyn.

## Cloudflare

- `wrangler.jsonc` behåller Worker-namnet `skvallerbyttan` och custom domain `skvallerbyttan.denied.se`.
- GitHub Actions ska inte deploya produktion; Cloudflare Workers Builds gör det.
- Runtime-secrets ska hanteras i Cloudflare, inte i Git/GitHub Actions.
- `assets.run_worker_first` ska förbli aktivt så att auth inte kan kringgås via statiska assets.
- D1-bindingen `STATS_DB` är valfri tills en riktig Cloudflare D1-databas har skapats och rätt `database_id` är versionerat; lägg aldrig in placeholder-ID i produktionskonfiguration.
- D1-migrationer ska appliceras mot rätt databas före en deploy som gör bindingen obligatorisk.

## Verifiering

Före PR: kör `npm run check`, granska hela diffen mot `main` och kontrollera att inga credentials eller secret payloads har introducerats. Efter push/PR: verifiera exakt final HEAD, required checks, Code Scanning och review-trådar enligt live rulesets.

## Definition of done

En ändring är klar först när implementationen är verifierad, CI/security-gates är gröna på exakt final HEAD och den har mergats via normal enforcement, eller tydligt väntar på en legitim extern gate som Cloudflare-secret eller deploy.
