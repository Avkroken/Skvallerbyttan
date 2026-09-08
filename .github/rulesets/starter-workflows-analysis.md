# Starter-workflow-analys för rulesets

## Regel

Lokala workflow-filer får endast vara direkt applicerbara filer från `actions/starter-workflows`. Endast uttryckliga placeholders i starterfilen får fyllas i. Action-versioner, matrixvärden, permissions, kommandon, paths, steps och job names ändras inte lokalt.

## Vald standardmall

- `actions/starter-workflows/code-scanning/dependency-review.yml`, med `$default-branch` ifylld som `main`.
- `actions/starter-workflows/.github/dependabot.yml` används oförändrad; repositoryt har root-`package.json`/npm-yta och GitHub Actions.

Dependency Review har körts framgångsrikt och producerar checken `dependency-review`.

## Node.js CI

`actions/starter-workflows/ci/node.js.yml` testades med endast branch-placeholdern ifylld. Starterfilens fasta matrix är Node 18.x, 20.x och 22.x och får inte ändras lokalt.

På den faktiska PR-körningen gick `build (22.x)` grönt och Node 20-teststeget grönt, men `build (18.x)` misslyckades. Loggen visar flera `EBADENGINE`-varningar eftersom bland annat Cloudflare/Wrangler-beroenden kräver Node >=22, och autentiseringstesterna misslyckades med `crypto is not defined` under Node 18.

Eftersom Node-versionerna inte är placeholders kan mallen inte göras kompatibel genom att ändra matrixen. Node.js CI tas därför bort och dokumenteras som ett täckningsgap.

## CodeQL

GitHubs CodeQL default setup är redan aktivt för repositoryt. Ingen lokal Advanced CodeQL-workflow läggs till.

## OSV-Scanner

GitHubs publicerade `code-scanning/osv-scanner.yml` testades med endast placeholders ifyllda. Den publicerade startermallen kunde inte köras framgångsrikt utan att ändra dess upstream-version/permission-kontrakt. Sådana ändringar är inte tillåtna enligt den här policyn. OSV-workflowen hålls därför borttagen och gapet dokumenteras.

## Required checks

Repositoryts versionshanterade target-ruleset får därför endast kräva den verifierade kvarvarande starter-checken:

- `dependency-review`

Den tidigare egna checken `CI / required` och tidigare Node-checkar ska inte krävas efter reseten.

## Dokumenterade täckningsgap

Följande funktioner har ingen direkt kompatibel starter-mall under placeholder-only-regeln och byggs inte om som egna workflows:

- Node/TypeScript-testning för repositoryts Node >=22-yta,
- `npm run typecheck`,
- Wrangler dry-run/Worker-validering,
- OSV-skanning med GitHubs för närvarande publicerade starterfil,
- tidigare release-orchestration,
- security-alert-specifika issue-/PR-mallar.
