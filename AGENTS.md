# AGENTS.md

Den här filen är repositoryts auktoritativa arbetsinstruktion. Live GitHub-konfiguration är verkställande sanning när dokumentation och faktisk enforcement skiljer sig.

## Status

`Skvallerbyttan` är avvecklad. Repositoryt får inte längre ta emot eller reconciliara GitHub-säkerhetsalerts, skapa säkerhets-Issues, skicka säkerhetsmail, skapa remediation-branches/PR:er, arma auto-merge eller delegera remediation.

GitHubs native Code Scanning, Copilot Autofix och Dependabot security updates är den avsedda vägen för säkerhetsalerts och remediation i Avkrokens repositories.

## Tombstone-runtime

- `src/worker.ts` är en tillfällig tombstone för säker avveckling av den redan deployade Cloudflare Workern.
- `GET /ready` ska returnera exakt `{ "ok": true, "service": "skvallerbyttan", "check": "decommissioned" }`.
- Alla andra HTTP-anrop ska returnera `410 Gone` och får inte göra GitHub-, e-post- eller annan extern write.
- Schemalagd hantering ska vara inert och `wrangler.jsonc` får inte innehålla någon cron-trigger.
- Durable Object-klassen får endast finnas kvar som kompatibilitetsstub tills Cloudflare-resurserna kan tas bort; gamla alarm ska rensa kvarvarande state utan externa writes.
- Återaktivera inte webhook-, alert-, Issue-, e-post- eller remediationlogik utan ett nytt uttryckligt arkitekturbeslut.

## Brancher och pull requests

- Pusha aldrig direkt till `main`.
- Arbeta på en kortlivad branch och öppna en ready PR till `main`.
- Squash är enda tillåtna merge-metod.
- Kringgå aldrig rulesets, required checks, reviews eller thread resolution.
- Efter varje ny commit ska exakt aktuell HEAD och samtliga gates verifieras igen.

## Live merge-policy

Organisationens aktiva rulesets är verkställande sanning. Vid den senaste verifieringen gäller bland annat:

- PR krävs till default branch.
- required approvals är 0.
- last-push approval krävs inte.
- review-trådar måste vara resolved.
- deletion och non-fast-forward/force push blockeras.
- endast squash merge är tillåten.
- `CI / required` är required genom org-rulesetet `ci`.
- `scan-pr / osv-scan` är required genom org-rulesetet `main`.
- CodeQL merge protection använder `medium_or_higher` för security alerts och `errors_and_warnings` för alerts.
- Copilot Code Review körs på pushes/drafts men är inte en required status check.
- inga bypass actors är konfigurerade.

## GitHub Actions och deploy

- `.github/workflows/ci.yml` producerar `CI / required`.
- `.github/workflows/osv-scanner.yml` producerar PR-context `scan-pr / osv-scan`.
- GitHub Actions får inte återinföra central alert/remediation-automation.
- Cloudflare Workers Builds är enda normala deploykedjan medan tombstone-workern finns kvar.
- `npm run deploy` ska fortsätta vara `wrangler deploy --strict`.
- `scripts/verify-production.mjs` ska endast verifiera att tombstone-state är live via `/ready`.
- När Cloudflare Worker, custom domain/webhook och relaterade credentials har tagits bort externt kan återstående tombstone-kod och repository tas bort eller arkiveras.

## Verifiering

Före PR: granska hela diffen mot `main` och kör relevanta kontroller. Efter push: verifiera exakt HEAD, required checks, Code Scanning, reviews och review-trådar. Efter merge av tombstone-ändringar ska Workers Builds på den mergade `main`-SHA:n vara grön och `/ready` ska verifiera `check: decommissioned`.

## Definition of done

En PR-baserad uppgift är klar först när implementationen är färdig, diffen självgranskad, all relevant review-feedback är hanterad, required checks och Code Scanning är godkända på exakt final HEAD, relevanta review-trådar är resolved och PR:n har mergats genom normal ruleset-enforcement eller väntar på en verifierad legitim extern gate.
