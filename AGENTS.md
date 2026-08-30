# AGENTS.md

Den här filen är repositoryts auktoritativa arbetsinstruktion. Live GitHub-konfiguration är verkställande sanning när dokumentation och faktisk enforcement skiljer sig.

## Repository

`Skvallerbyttan` är Avkrokens centrala säkerhetsalert- och remediationtjänst.

- `src/worker.ts` är Worker-entrypoint och ansvarar för webhook-gräns, persistent idempotens och runtime-readiness.
- `src/index.ts` hanterar GitHub organization-webhooks, backfillar alerts och reconciliar security Issues.
- `.github/workflows/codex-security-dispatch.yml` är den enda GitHub-side writer som skapar automatiska Codex-remediation-branches och PR:er i organisationen.
- `wrangler.jsonc` beskriver Worker-bindings, routes och Worker-cron.
- Credentials och privata nycklar får aldrig committas eller loggas.

## Brancher och pull requests

- Pusha aldrig direkt till `main`.
- Använd en kortlivad branch och öppna en ready PR till `main`.
- Aktivera auto-merge omedelbart när PR:n skapats, även medan CI eller review pågår.
- Använd inte direkt merge om det inte uttryckligen begärts.
- Live-rulesetet tillåter endast squash merge.
- Repositoryt använder inte merge queue och har ingen obligatorisk återanvändbar branchpool.
- Central Codex-remediation använder körningsunika branches under `automation/codex-issue/`.

## Merge-gates

För `main` gäller:

- required status check: `CI / required`
- olösta review-trådar blockerar merge
- Copilot Code Review körs vid push till PR-grenen
- squash är enda tillåtna merge-metod

Alla review-kommentarer och trådar ska läsas och utvärderas. Relevanta findings åtgärdas i samma PR. En tråd markeras resolved först när eventuell nödvändig fix är pushad och verifierad.

Efter varje ny commit ska relevant CI och review-status kontrolleras igen. När required CI är grön och alla relevanta review-trådar är resolved ska den redan armerade auto-merge-funktionen föra PR:n till `main`.

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
- När scope-gaten är uppfylld ska auto-merge armeras. Om GitHub nekar ska PR:n lämnas öppen och blockeraren dokumenteras; direkt merge får inte användas automatiskt.
- Branch protection, required CI och review-resolution i målrepositoryt är alltid auktoritativa.

## Security alert-ingestion

- GitHub organization-webhooken är eventkällan.
- Worker-signaturen `X-Hub-Signature-256` ska verifieras före payloadbehandling.
- Webhook-body ska begränsas och signerade `X-GitHub-Delivery` ska dedupliceras persistent.
- Alert→Issue-skapande och backfill/reconciliation ska vara idempotenta även över Worker-restarts.
- Dismissed alerts behandlas inte som verifierade fixes.
- Secret Scanning-innehåll får aldrig kopieras till Issue- eller e-posttext.
- Per-repository Code Scanning-snapshotfiler ska inte användas som separat datakälla; Skvallerbyttan läser GitHubs alert-API centralt.

## GitHub Actions

- `.github/workflows/ci.yml` producerar live-required context `CI / required`.
- Required CI kör tester, typecheck, binding-validering, Wrangler dry-run och blockerar kvarvarande `.github/codex-dispatch/issue-*.md`.
- `.github/workflows/osv-scanner.yml` är kompletterande säkerhetsverifiering och är inte en required context.
- `pr-watchdog`, `sync-pool`, `scope-policy`, repository-local remediation-observer, bot-baserad review-auto-fix och Code Scanning-snapshot ska inte återinföras utan ett nytt verifierat behov och motsvarande live ruleset/design.

## Verifiering

Före PR: granska hela diffen mot `main` och kör relevant test/typecheck/binding-validering. Efter varje push: kontrollera aktuell HEAD, required CI, övriga relevanta säkerhetsjobb, mergeability och review-trådar igen.

När ändringen påverkar Cloudflare bindings, secrets, routes, cron eller annan live-konfiguration ska den deployade konfigurationen verifieras efter merge/deploy.

## Definition of done

En PR-baserad uppgift är klar först när implementationen är färdig, diffen självgranskad, all review-feedback utvärderad, required `CI / required` är grön, relevanta review-trådar är resolved och auto-merge har mergat PR:n eller en konkret extern blockerare är verifierad och rapporterad.
