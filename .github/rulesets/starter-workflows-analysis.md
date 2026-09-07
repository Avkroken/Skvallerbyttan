# Starter-workflow-analys för rulesets

## Aktuell repo-yta

Repositoryt är ett Node/TypeScript-projekt. `package.json` använder Node-baserade tester samt separata `typecheck`- och Wrangler-dry-run-steg.

## Valda standardmallar

- `actions/starter-workflows/ci/node.js.yml`, anpassad endast till repositoryts Node 24-runtime.
- `actions/starter-workflows/code-scanning/dependency-review.yml`.
- `actions/starter-workflows/.github/dependabot.yml` för npm och GitHub Actions.

Action-referenser i workflow-filerna är fullständigt SHA-pinnade till samma v4-referenser som standardmallarna använder, för att passa repositoryts Actions-säkerhetspolicy utan att lägga till egen workflow-logik.

## CodeQL

Repositoryt har redan GitHubs CodeQL default setup aktivt; en aktuell dynamisk CodeQL-körning på `main` har lyckats. Därför läggs ingen lokal `codeql.yml` till, så att default setup och Advanced setup inte konkurrerar.

CodeQL-checken läggs inte in i repositoryts versionshanterade required-check-underlag förrän dess faktiska default-setup-checknamn är verifierat som lämpligt för PR-gating.

## OSV-Scanner

Starter-workflowen testades på den här PR-branchen men körningen slutade i `startup_failure` innan GitHub skapade något jobb. Den körningen bevisar därför inget användbart required-checknamn. OSV-workflowen tas bort i stället för att byggas om eller ersättas med en egen variant.

## Required checks

Efter korrigeringen har båda kvarvarande starter-workflows producerat lyckade jobb på den här PR-branchen. De observerade jobben är:

- Node.js CI: `build (24.x)`
- Dependency review: `dependency-review`

Dessa är de repo-specifika checknamn som får användas i repositoryts `main`-ruleset. Den tidigare egna checken `CI / required` ska inte längre krävas när workflow-reseten rullas ut.

## Funktioner som standardmallarna inte täcker

Node.js-standardmallen kör `npm test`, men repositoryts tidigare `npm run check` innehöll dessutom:

- `npm run typecheck`,
- `npm run validate:worker` (Wrangler dry-run).

Dessa repo-specifika valideringar byggs inte in som egna workflow-steg eftersom uppdraget kräver att standardmallens ramar behålls. De dokumenteras som täckningsgap.

Det saknas även en passande starter-mall för:

- security-alert-specifik issue-mall,
- security-alert-specifik PR-mall,
- repositoryts tidigare release-orchestration.

Inga egna ersättningar skapas för dessa gap.
