# AGENTS.md

Den här filen är repositoryts auktoritativa arbetsinstruktion. Live GitHub-konfiguration är verkställande sanning när dokumentation och faktisk enforcement skiljer sig.

## Repository

`Skvallerbyttan` är Avkrokens centrala säkerhetsalert- och remediationtjänst.

- `src/worker.ts` är Worker-entrypoint och ansvarar för webhook-gräns, persistent idempotens och runtime-readiness.
- `src/index.ts` hanterar GitHub organization-webhooks, backfillar alerts och reconciliar security Issues.
- `.github/workflows/codex-security-dispatch.yml` är den enda GitHub-side writer som skapar automatiska Codex-remediation-branches och PR:er i organisationen.
- `wrangler.jsonc` beskriver Worker-bindings, routes, Worker-cron och Durable Object-migrationer.
- Credentials och privata nycklar får aldrig committas eller loggas.

## Brancher och pull requests

- Pusha aldrig direkt till `main`.
- Använd en kortlivad branch och öppna en ready PR till `main`.
- Auto-merge får aktiveras först när live-rulesetet är verifierat, aktuell PR-HEAD är känd, samtliga obligatoriska CI/security-gates för den HEAD:en är identifierade och inga manuella rulesetåtgärder återstår.
- Använd inte direkt merge om det inte uttryckligen begärts.
- Live-rulesetet tillåter endast squash merge.
- Repositoryt använder inte merge queue och har ingen obligatorisk återanvändbar branchpool.
- Central Codex-remediation använder körningsunika branches under `automation/codex-issue/`.

## Merge-gates

För `main` gäller live-rulesetet `main-enforcement`:

- required status checks: `CI / required` och `scan-pr / osv-scan`
- `strict_required_status_checks_policy: true`; PR:n ska verifieras mot aktuell `main`
- Code Scanning merge protection för `CodeQL`: security alerts `medium_or_higher` och alerts `errors_and_warnings`
- 0 generella approvals och ingen last-push-approval
- olösta review-trådar blockerar merge
- Copilot Code Review körs vid nya pushes, men är rådgivande och inte en required status check
- CodeRabbit är best effort och är inte en required status check; quota, rate limit eller tjänsteavbrott blockerar inte ensamt merge
- force push/non-fast-forward och deletion av `main` blockeras
- inga bypass actors
- squash är enda tillåtna merge-metod

Alla review-kommentarer och trådar ska läsas och utvärderas. Relevanta findings åtgärdas i samma PR. En tråd markeras resolved först när eventuell nödvändig fix är pushad och verifierad. Faktiska CodeRabbit- eller Copilot-findings behandlas enligt samma princip även om respektive tjänst inte är en hard gate.

Efter varje ny commit ska aktuell PR-HEAD, `CI / required`, `scan-pr / osv-scan`, CodeQL merge protection och review-trådar kontrolleras igen. CodeRabbit- och Copilot-status får observeras men deras otillgänglighet är inte ensam merge-blockerare. När alla obligatoriska gates för aktuell HEAD är gröna och alla relevanta review-trådar är resolved får auto-merge föra PR:n till `main`.

Om GitHub vägrar armera eller utföra auto-merge ska den konkreta blockeraren identifieras. Kringgå inte repositoryskydd och använd inte direkt merge som fallback utan uttrycklig begäran.

## Central Codex-remediation

- `.github/workflows/codex-security-dispatch.yml` är enda automatiska branch-/PR-dispatcher.
- Den får skapa högst en aktiv remediation per repository.
- Nya remediationer använder en unik branch `automation/codex-issue/<issue>-<run>-<attempt>` från målrepositoryts aktuella default branch.
- Seed-only PR:er ska vara draft och får inte ha auto-merge armerad.
- `CODEX_TRIGGER_TOKEN` ska verifieras mot `CODEX_TRIGGER_LOGIN`; utan giltig användarcredential failar ny dispatch stängt.
- Codex-triggern ska skrivas med den verifierade användarcredentialen; bot-skrivna `@codex`-mentions är inte ett giltigt delegationskontrakt.
- PR:n får inte bli ready förrän seed-filen är borttagen, minst en verklig filändring finns och den ursprungliga GitHub-alerten fortfarande är öppen med verifierad alert-relevant scope.
- Code Scanning kräver ändring av alertens source path. Dependabot kräver manifest eller relevant sibling lockfile. Secret Scanning kräver ändring av en verifierad commit-location. Oförifierbar scope eller API-/permissionfel failar stängt.
- När scope-gaten är uppfylld ska auto-merge armeras först när målrepositoryts obligatoriska merge-gates är verifierade för aktuell HEAD. Om GitHub nekar ska PR:n lämnas öppen och blockeraren dokumenteras; direkt merge får inte användas automatiskt.
- Branch protection, required CI/security-gates och review-resolution i målrepositoryt är alltid auktoritativa.

## Security alert-ingestion

- GitHub organization-webhooken är eventkällan.
- Worker-signaturen `X-Hub-Signature-256` ska verifieras före payloadbehandling.
- Webhook-body ska begränsas och signerade `X-GitHub-Delivery` ska dedupliceras persistent.
- Alert→Issue-skapande och backfill/reconciliation ska vara idempotenta även över Worker-restarts.
- Dismissed alerts behandlas inte som verifierade fixes.
- Secret Scanning-innehåll får aldrig kopieras till Issue- eller e-posttext.
- Per-repository Code Scanning-snapshotfiler ska inte användas som separat datakälla; Skvallerbyttan läser GitHubs alert-API centralt.

## GitHub Actions och Cloudflare

- `.github/workflows/ci.yml` producerar live-required context `CI / required`.
- Required CI kör tester, typecheck, binding-validering, Wrangler dry-run och blockerar kvarvarande `.github/codex-dispatch/issue-*.md`.
- `.github/workflows/osv-scanner.yml` producerar live-required PR-context `scan-pr / osv-scan`; den pinnade reusable PR-skanningen failar på nya sårbarheter.
- OSV:s `scan-main` är kompletterande scanning på `main`/schedule/manual och är inte en required PR-context.
- CodeQL verkställs separat genom GitHub Code Scanning merge protection med trösklarna `medium_or_higher` för security alerts och `errors_and_warnings` för alerts.
- `.coderabbit.yaml` behåller inheritance, commit-statusrapportering och fail-status vid reviewfel samt automatisk inkrementell review utan auto-paus. CodeRabbit-status är observerbar men inte required.
- `pr-watchdog`, `sync-pool`, `scope-policy`, repository-local remediation-observer, bot-baserad review-auto-fix och Code Scanning-snapshot ska inte återinföras utan ett nytt verifierat behov och motsvarande live ruleset/design.
- Cloudflare Workers Builds är enda normala produktionsdeploykedjan från `main`; GitHub Actions ska inte deploya produktion.
- Production trigger ska använda branch `main`, repository-root `/`, tomt build command och avstängda non-production branch builds.
- Workers Builds deploy command ska vara `npm run deploy && npm run verify:production`.
- `deploy` ska vara direkt `wrangler deploy --strict`. Full `npm run check` hör till GitHubs merge-gate och ska inte dupliceras som npm `predeploy` i Workers Builds.
- `scripts/verify-production.mjs` får endast verifiera `GET https://skvallerbyttan.denied.se/ready` och kräva HTTP 200 med exakt healthy configuration-payload. Scriptet får inte deploya, tolka Workers Builds branch/SHA eller bli en parallell kontrollplan.
- Build watch paths ska vara `src/**`, `scripts/verify-production.mjs`, `wrangler.jsonc`, `package.json`, `package-lock.json` och `tsconfig.json`.
- `wrangler.jsonc` är source of truth för bindings, custom domain, cron, Durable Object-migrationer, observability och publika Worker-ytor. `workers_dev` och `preview_urls` ska vara explicit avstängda.

## Verifiering

Före PR: granska hela diffen mot `main` och kör relevant test/typecheck/binding-validering. Efter varje push: kontrollera aktuell HEAD, båda required status checks, CodeQL merge protection, övriga relevanta säkerhetsjobb, mergeability och review-trådar igen.

När ändringen påverkar Cloudflare bindings, secrets, routes, cron eller annan live-konfiguration ska den deployade konfigurationen verifieras efter merge/deploy. För produktionsändringar innebär det normalt en grön Workers Builds-run på den mergade `main`-SHA:n där strict deploy och `/ready`-verifieringen har passerat.

## Definition of done

En PR-baserad uppgift är klar först när implementationen är färdig, diffen självgranskad, all review-feedback utvärderad, `CI / required` och `scan-pr / osv-scan` är gröna för exakt final HEAD, CodeQL merge protection är godkänd, relevanta review-trådar är resolved, live-rulesetet fortfarande matchar policyn och auto-merge har mergat PR:n eller en konkret extern blockerare är verifierad och rapporterad.

## PR-scope efter öppning

Den här sektionen förtydligar tidigare formuleringar om att relevanta findings ska åtgärdas i samma PR.

- När en PR har öppnats är dess avsedda scope, så som det beskrivs i PR:n, fryst. Fortsatta commits får endast slutföra eller korrigera det scopet.
- Om CI, Code Scanning, tester eller review hittar ett fel som orsakas av PR:ns befintliga ändringar ska just det felet rättas på samma branch/PR. Det är en korrigering inom scope, inte ny scope.
- Ny funktionalitet, opportunistiska refactors, städning eller separata förbättringar som upptäcks efter att PR:n öppnats ska få en ny kortlivad branch och en ny PR från aktuell `main`; återanvänd inte den öppna PR-grenen för nästa uppgift.
- Försök inte hinna lägga commits före eller under en pågående CI-/reviewkörning av tidsskäl. Gör en komplett ändring, pusha den, låt gates utvärdera den HEAD:en och reagera därefter.
- Efter varje korrigerande commit ska relevanta tester köras om och hela tillämpliga gate- och review-state verifieras på den nya HEAD:en före merge.
