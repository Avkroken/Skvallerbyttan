# Skvallerbyttan

Skvallerbyttan är avvecklad.

Den tidigare tjänsten tog emot organisationens GitHub-säkerhetsalerts och skapade/reconcilerade egna säkerhets-Issues. Den arkitekturen har ersatts av GitHubs native Code Scanning, Copilot Autofix och Dependabot security updates. Repositoryts egna GitHub Actions får inte återinföra alert→Issue-, remediation-, branch-/PR- eller auto-merge-automation.

## Nuvarande runtime

Cloudflare Workern ligger tillfälligt kvar som en tombstone medan externa resurser tas bort säkert:

- `GET https://skvallerbyttan.denied.se/ready` returnerar HTTP 200 med `{ "ok": true, "service": "skvallerbyttan", "check": "decommissioned" }`.
- Alla andra endpoints returnerar `410 Gone`.
- Ingen webhook behandlas.
- Ingen säkerhets-Issue skapas eller återöppnas.
- Ingen e-post skickas.
- Ingen remediation, branch, PR eller auto-merge skapas eller ändras.
- Cloudflare-cron är borttagen.
- Durable Object-klassen finns endast kvar som kompatibilitetsstub och rensar eventuellt gammalt alarm-state utan externa writes.

## GitHub-native säkerhet

Code Scanning och Dependabot är organisationens säkerhetskontrollplan. Dependabot security updates styrs av Avkrokens org-level GitHub security configuration som gäller repositories i organisationen; Skvallerbyttan ska inte duplicera eller ersätta den funktionen.

Repositoryts egna Actions-lager är begränsat till verifiering:

- `.github/workflows/ci.yml` producerar `CI / required`.
- `.github/workflows/osv-scanner.yml` producerar `scan-pr / osv-scan`.

GitHub Actions deployar inte produktion och får inte fungera som central säkerhetsdispatcher.

## Slutlig borttagning

När Cloudflare Worker/custom domain och den gamla GitHub-webhook-/App-konfigurationen har tagits bort externt kan tombstone-runtime, kvarvarande gamla implementation och repositoryt arkiveras eller raderas. Credentials och secrets ska då återkallas i respektive tjänst; de ska aldrig flyttas till Git eller GitHub Actions.
