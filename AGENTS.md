# AGENTS.md

Den här filen är repositoryts auktoritativa arbetsinstruktion. Live GitHub-konfiguration är verkställande sanning när dokumentation och faktisk enforcement skiljer sig.

## Repository

`Skvallerbyttan` är Avkrokens centrala mottagare och reconcilerare för GitHub-säkerhetsalerts.

- `src/worker.ts` äger webhook-gräns, persistent idempotens och readiness.
- `src/index.ts` hanterar organization-webhooks, alert-backfill och security Issues.
- `wrangler.jsonc` äger Worker-bindings, route, cron, Durable Object-migrationer och observability.
- Cloudflare Workers Builds äger normal produktionsdeploy från `main`.
- Repositoryt får inte skapa eller uppdatera branches/PR:er i andra repositories, arma auto-merge eller delegera remediation via GitHub Actions.
- Credentials, privata nycklar och secret-värden får aldrig committas eller loggas.

## Brancher och pull requests

- Pusha aldrig direkt till `main`.
- Arbeta på en kortlivad branch och öppna en ready PR till `main`.
- Squash är enda tillåtna merge-metod.
- Kringgå aldrig rulesets, required checks, reviews eller thread resolution.
- Efter varje ny commit ska exakt aktuell HEAD och samtliga gates verifieras igen.

## Live merge-policy

Organisationens aktiva rulesets är verkställande sanning. Vid den senaste verifieringen gäller bland annat:

- PR krävs till default branch.
- 1 approval krävs.
- stale approvals avfärdas efter push.
- last-push approval krävs av någon annan än den som gjorde senaste pushen.
- review-trådar måste vara resolved.
- deletion och non-fast-forward/force push blockeras.
- endast squash merge är tillåten.
- `CI / required` är required genom org-rulesetet `ci`.
- `scan-pr / osv-scan` är required genom org-rulesetet `main`.
- CodeQL merge protection använder `medium_or_higher` för security alerts och `errors_and_warnings` för alerts.
- Copilot Code Review körs på pushes/drafts men är inte en required status check.
- inga bypass actors är konfigurerade.

Org-rulesetet `main` refererar för närvarande även till Regelverkets `.github/workflows/osv-scanner.yml` som central required workflow. Det är org-level live-state och kan inte neutraliseras i detta repository. Repositoryts egen OSV-workflow ska ändå vara självständig; den centrala required-workflow-referensen måste tas bort separat på organisationsnivå för att målarkitekturen ska bli helt repo-specifik.

## GitHub Actions

Repositoryt äger endast sina egna verifieringsbehov:

- `.github/workflows/ci.yml` producerar `CI / required` och kör projektets etablerade `npm run check` efter ren installation.
- `.github/workflows/osv-scanner.yml` kör repo-lokal OSV-skanning. PR-jobbet producerar `scan-pr / osv-scan`; `main`/schedule/manual används för kompletterande rapportering.
- GitHub Actions ska inte deploya produktion; Cloudflare Workers Builds gör det.
- GitHub Actions ska inte skapa/uppdatera branches eller PR:er, arma auto-merge, köra PR-maintenance eller agera central security-remediation-dispatcher.
- Använd minsta nödvändiga `permissions` och pinna Actions/reusable workflows till full commit-SHA när praktiskt möjligt.

## Security alert-ingestion

- `X-Hub-Signature-256` verifieras före payloadbehandling.
- webhook-body begränsas och signerade `X-GitHub-Delivery` dedupliceras persistent.
- alert→Issue och backfill/reconciliation ska vara idempotenta över Worker-restarts.
- dismissed alerts behandlas inte som verifierade fixes.
- Secret Scanning-innehåll får aldrig kopieras till Issue- eller e-posttext.
- per-repository Code Scanning-snapshotfiler ska inte användas som separat datakälla.

## Cloudflare

- Workers Builds är enda normala produktionsdeploykedjan från `main`.
- `deploy` ska vara direkt `wrangler deploy --strict`.
- `scripts/verify-production.mjs` verifierar endast `/ready` efter deploy.
- `wrangler.jsonc` är source of truth för versionerad Worker-konfiguration.
- Ändra inte runtime-secrets via Git eller GitHub Actions.

## Verifiering

Före PR: läs relevant kod, tester och konfiguration, granska hela diffen mot `main` och kör relevanta lokala kontroller när det är möjligt. Efter push: verifiera exakt HEAD, required checks, Code Scanning, reviews och review-trådar. Faktiska Copilot/CodeRabbit-findings ska utvärderas även när tjänsten inte är en hard gate.

## Definition of done

En PR-baserad uppgift är klar först när implementationen är färdig, diffen självgranskad, all relevant review-feedback är hanterad, required checks och Code Scanning är godkända på exakt final HEAD, nödvändig approval finns, relevanta review-trådar är resolved och PR:n har mergats genom normal ruleset-enforcement eller väntar på en verifierad legitim extern gate.
