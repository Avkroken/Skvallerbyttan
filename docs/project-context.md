---
layout: default
title: Projektkontext
permalink: /project-context/
---

# Skvallerbyttan project context

Det här dokumentet beskriver repositoryts aktuella tekniska state och ska uppdateras när arkitektur, GitHub-policy, deploymentmodell eller integrationsgränser ändras.

**Senast verifierad:** 2026-09-19

## Auktoritet och läsordning

Vid konflikt gäller i första hand aktuell live-state i berört system, därefter aktiva GitHub-organisationsregler och repositoryinställningar, sedan filer på `main` och sist det här dokumentet.

Avkrokens organisationsgemensamma GitHub-standard finns i `Avkroken/.github/docs/engineering-context.md`.

## Repository

- Repository: `Avkroken/Skvallerbyttan`
- Visibility: public
- Default branch: `main`
- Befintliga långlivade branches vid verifieringen: `main` och `dev`
- Huvudspråk/runtime: TypeScript / Cloudflare Workers
- Produktionsadress: `https://skvallerbyttan.denied.se`
- Repositoryt är markerat som template.
- Licens: MIT.

Agentdrivna ändringar följer Avkrokens centrala arbetsgrensformat och går via pull request till default branch.

## Syfte

Skvallerbyttan är en privat operativ dashboard för Avkroken. Den sammanställer repositoryhälsa, säkerhetsalerts, Actions-data, pull requests, issues, deployments och historik från GitHub samt read-only Notifications-/CASB-state och webhookhändelser från Cloudflare.

Dashboarden är privat även om repositoryt och projektdokumentationen är publika.

## GitHub Custom Properties och rulesets

Verifierad repositoryklassning:

- `ci_stack = node`
- `platform = cloudflare`

Effektiva organisations-rulesets på default branch vid verifieringen:

- `main` — generell default-branch-policy med PR-krav, blockerad deletion/force-push, CodeQL, code quality, secret-scanning-resolution, dependency review och Copilot code review. Inga bypass-aktörer är konfigurerade.
- `main-node` — kräver Avkrokens centrala Node-workflow.
- `main-cloudflare` — kräver Avkrokens centrala Cloudflare-workflow.

Repositorypolicy får inte försvagas för att få en ändring att passera.

## Runtime

`wrangler.jsonc` definierar:

- Worker `skvallerbyttan`
- entrypoint `src/entry.ts`
- statiska assets i `public/`
- Worker-first asset routing
- custom domain `skvallerbyttan.denied.se`
- D1-bindningen `STATS_DB`
- cron `0 */6 * * *`
- observability med loggar och traces
- `workers_dev = false`
- preview-URL:er avstängda

Produktionsdeployment är en separat Cloudflare-åtgärd och ska inte ske implicit från dokumentationsarbete.

## Autentisering

Skvallerbyttan använder separata GitHub-identiteter:

- **Gamnacke GitHub App** för tjänstens GitHub API-åtkomst. Worker-koden mintar installation tokens från ett kortlivat app-JWT.
- **Krösa-Maja GitHub OAuth** för användarinloggning. Flödet använder `read:user`, PKCE S256 och en explicit GitHub-ID-allowlist.

OAuth-tokenet lagras inte av Skvallerbyttan och koden försöker återkalla det efter identitetsuppslaget.

Den lokala sessionen är HMAC-signerad, lagras i en `__Host-`-cookie och har högst tolv timmars livslängd.

Cloudflare använder en tredje separat tjänsteidentitet: ett API-token med read-only permissions `Notifications Read` och `Zero Trust Read`. Webhookautentisering använder två egna secrets som inte återanvänds mellan Notifications, CASB eller GitHub.

## Data och cache

D1 används för:

- organisations- och repositorysnapshots,
- source/API-cache,
- webhook-delivery-deduplicering,
- säkerhetshändelser,
- normaliserade Cloudflare Notifications-/CASB-events.

GitHub source-cache-TTL är sex timmar och Cloudflare-läsningar använder 15 minuter. Webhooks invaliderar berörd cache och nästa läsning kan trigga bakgrundsuppdatering. En cron-driven reconciliation körs var sjätte timme för GitHub och, när Cloudflare API-konfiguration finns, även för Cloudflare-källorna.

Säkerhetsledgern lagrar metadata för Code Scanning-, Dependabot- och Secret Scanning-händelser, inte själva upptäckta hemligheten.

## Publika och privata endpoints

Publika drift-/auth-endpoints före dashboardautentisering:

- `/health`
- `/healthz`
- `/ready`
- `/login`
- `/auth/github`
- `/auth/github/callback`
- `/auth/logout`
- `/webhooks/github`
- `/webhooks/cloudflare/notifications`
- `/webhooks/cloudflare/casb`

Dashboard-API:t bakom autentisering:

- `/api/overview`
- `/api/security-activity`
- `/api/history`
- `/api/insights/:repo`
- `/api/repos/:repo`
- `/api/cloudflare/activity`
- `/api/cloudflare/notifications/history`
- `/api/cloudflare/notifications/policies`
- `/api/cloudflare/notifications/webhooks`
- `/api/cloudflare/casb/webhooks`

## Dokumentation och katalogisering

Repositoryts README är den korta ingången. Den utförliga publika dokumentationen ligger i `docs/` och publiceras genom Avkrokens centrala GitHub Pages-workflow.

GitHub Pages är aktiverat för repositoryt. Repositorymetadata rapporterar `has_pages = true`, och projektets Pages-adress är:

```text
https://avkroken.github.io/Skvallerbyttan/
```

Pages-publiceringen använder repositoryts dokumentationsworkflow; dashboardens produktionsdomän förblir `https://skvallerbyttan.denied.se`.

Avkrokens centrala portal katalogiserar publika repositories utifrån repositorymetadata. Skvallerbyttan uppfyller katalogregeln genom att vara publikt, oarkiverat, ha kategoritopic `service` och en publik HTTPS-homepage. Live-renderingen av den externa portalen verifierades inte i den här dokumentationsändringen.

## Verifiering

Repositoryts fulla lokala kontroll är:

```bash
npm ci
npm run check
```

`npm run check` kör tester, TypeScript typecheck och Wrangler dry-run.

## Uppdateringskontrakt

Uppdatera detta dokument när något av följande förändras:

- runtime eller Cloudflare-bindningar,
- GitHub App- eller OAuth-ansvar,
- auth- eller sessionsmodell,
- cache/reconciliation/webhookmodell,
- D1-användning eller migrationsansvar,
- Custom Properties eller effektiva rulesets,
- CI-verifieringskommandon,
- produktionsdomän,
- GitHub Pages-status eller dokumentationsarkitektur.

Historik finns i Git; dokumentet ska beskriva current state och inte samla föråldrade varianter.
