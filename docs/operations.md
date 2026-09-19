---
layout: default
title: Drift
permalink: /operations/
---

# Drift

## Verifiering

```bash
npm ci
npm run check
```

`npm run check` kör:

1. testsvit
2. TypeScript typecheck
3. `wrangler deploy --dry-run`

Dry-run är inte deployment.

## Bindings och secrets

Wrangler definierar:

- `ASSETS`
- `STATS_DB`
- `OBSERVABILITY` — Analytics Engine dataset `skvallerbyttan_observability`
- cron `0 */6 * * *`
- custom domain `skvallerbyttan.denied.se`
- Cloudflare account via versionerad `account_id`

Icke-hemlig runtime-konfiguration:

- `CLOUDFLARE_ACCOUNT_ID`
- `GAMNACKEN_GITHUB_APP_CLIENT_ID`
- `KROSA_MAJA_GITHUB_CLIENT_ID`

Cloudflare Secrets Store-bindings:

- `CLOUDFLARE_API_TOKEN_R1` — Platform / Resource Read
- `CLOUDFLARE_API_TOKEN_R2` — Analytics / Content / Operations Read
- `CLOUDFLARE_API_TOKEN_R3` — Security / Identity Read
- `KROSA_MAJA_CLIENT_SECRET`
- `SKVALLERBYTTAN_GITHUB_WEBHOOK_SECRET`
- `SKVALLERBYTTAN_CLOUDFLARE_WEBHOOK_SECRET`

Varje bunden Secrets Store-secret ska ha `workers` i sin scope-lista. Bindings hämtar värden asynkront via `get()`; kodvägarna använder inte äldre generiska Cloudflare-token eller Skvallerbyttan-specifika aliases som fallback.

Vanliga Worker secrets:

- `GAMNACKEN_GITHUB_APP_PRIVATE_KEY`
- `SKVALLERBYTTAN_SESSION_SECRET`
- `SKVALLERBYTTAN_READ_API_TOKEN` — valfri machine read API

Gamnackens privata GitHub App-nyckel ligger som vanlig Worker secret eftersom den råa RSA-PEM-representationen överskrider Secrets Stores nuvarande 1024-bytegräns per secret. Koden accepterar PKCS#1 `RSA PRIVATE KEY` och PKCS#8 `PRIVATE KEY`; PKCS#1 wrap:as till PKCS#8 i minnet före Web Crypto-import.

GitHub Actions som muterar Cloudflare använder endast `CLOUDFLARE_API_TOKEN_W1`. Wrangler får värdet via den miljövariabel som verktyget kräver, `CLOUDFLARE_API_TOKEN`, men det finns inget generiskt org-secret med det namnet.

### Runtime secret-sync

`.github/workflows/sync-cloudflare-runtime-secrets.yml` är endast `workflow_dispatch` och delar concurrency-grupp med produktionsdeploy.

Workflowen använder W1 och synkar endast Worker-lokala secrets som inte kan eller ska vara Secrets Store-bindings:

- `GAMNACKEN_GITHUB_APP_PRIVATE_KEY`
- valfri `SKVALLERBYTTAN_READ_API_TOKEN`

R1/R2/R3, Krösa-Majas client secret och båda webhook-credentials läses direkt från Cloudflare Secrets Store och kopieras inte från GitHub till vanliga Worker secrets.

Cloudflare Notifications och CASB använder samma `SKVALLERBYTTAN_CLOUDFLARE_WEBHOOK_SECRET`, men verifierar den via respektive protokolls/header-mekanism. GitHub använder den separata `SKVALLERBYTTAN_GITHUB_WEBHOOK_SECRET`.

Deploy av en Worker med Secrets Store-bindings kräver att W1 täcker Secrets Store Write. Varje bunden secret måste dessutom vara scope:ad för `workers`.

### Rotation

Permissionsändring och secretrotation är separata operationer.

För en etablerad klass:

1. rolla endast den aktuella Cloudflare-tokenen,
2. uppdatera motsvarande centrala credentialvärde,
3. synka berörda runtime-bindings/secrets,
4. verifiera provider capabilities,
5. revokera eller ta bort gamla migreringscredentials först när de inte längre används.

## Migrationer

D1-migrationer:

- `0001_statistics_history.sql`
- `0002_api_cache.sql`
- `0003_security_events.sql`
- `0004_cloudflare_events.sql`
- `0005_observations.sql`

`0005` skapar `capability_observations` och `observation_events`.

Migrationen ska appliceras som separat driftåtgärd efter merge; repositoryverifiering applicerar den inte på produktion.

## Retention

Nuvarande policy i kod/runtime:

| Datatyp | Retention |
| --- | --- |
| webhook delivery dedup | 7 dagar |
| generic `observation_events` | 90 dagar |
| äldre Cloudflare detailed events | 90 dagar |
| Analytics Engine read telemetry | 3 månader, provider-managed |
| source cache | senaste canonical entry per key |
| snapshots | ingen automatisk prune i nuvarande implementation |
| security event ledger | ingen automatisk prune i nuvarande implementation |

Snapshot/security-retention är därför en känd operativ begränsning, inte en dold standard.

## Metricsval

Read telemetry ligger i Workers Analytics Engine i stället för D1. Skälen är att telemetry ligger på en högfrekvent kodväg, Analytics Engine-write är avsedd för detta och D1-write för varje cache-hit skulle ge onödiga row writes.

Verifierat 2026-09-19:

- Analytics Engine retention: 3 månader.
- Workers Paid publicerad prismodell: 10 miljoner datapunkter/månad inkluderat, därefter $0.25/miljon; 1 miljon SQL reads/månad inkluderat, därefter $1.00/miljon.
- Cloudflare anger fortfarande att Analytics Engine ännu inte faktureras trots publicerad kommande prismodell.
- D1 Workers Paid inkluderar 25 miljarder rows read/månad och 50 miljoner rows written/månad; write-overage är $1/miljon rows.
- D1 Free enforcement för dagliga limits är aktivt sedan 2026-09-01.

Faktisk Skvallerbyttan-volym efter denna ändring är inte verifierad före deployment. En Analytics Engine datapunkt skrivs per instrumenterad read/refresh. Activity-events skrivs endast för observerade provider-events, inte cache-hits.

## Reconciliation

Cron var sjätte timme:

- uppdaterar GitHub overview
- uppdaterar GitHub governance där read-permission finns
- uppdaterar Cloudflare account/zones/Workers
- uppdaterar D1/KV/R2 inventories
- uppdaterar Access applications och Tunnels
- läser ett begränsat Audit Log-fönster och deduplicerar event
- prunar gamla Activity-events och webhook deliveries

Reconciliation ska inte skapa provider-write-trafik.

## Cache

TTL är capability-specifik. Stale data kan returneras med headers:

- `X-Skvallerbyttan-Cache`
- `X-Skvallerbyttan-Cache-Age`
- `X-Skvallerbyttan-Cache-Refreshed-At`
- `X-Skvallerbyttan-Cache-Ttl`

Stale state startar background refresh genom single-flight när möjligt.

## Provider budgets

GitHub använder normala response headers för limit, remaining, used, reset, resource och Retry-After.

Cloudflare sparar Ratelimit/Ratelimit-Policy/Retry-After och throttlingstate från normala API-responser.

Insyn visar denna senaste observerade budgetstate. Avsaknad av tidigare anrop är `not_observed`, inte healthy.


## Explicit produktionsdeploy

`.github/workflows/deploy-production.yml` är den reproducerbara vägen för att föra en redan mergad version till produktion. Workflowen är endast `workflow_dispatch`, vägrar köra från annat ref än `main` och kör i ordning:

1. `npm run check`
2. valfri, default-på applicering av `migrations/0005_observations.sql` mot remote `skvallerbyttan-stats`
3. `npm run deploy`
4. `npm run verify:production` mot `/health` och `/ready`

Workflowen använder W1 genom `CLOUDFLARE_API_TOKEN_W1`. Wrangler exponeras värdet som `CLOUDFLARE_API_TOKEN`, vilket är verktygets fasta miljövariabelnamn och inte ett separat generiskt org-secret.

W1 behöver täcka Worker deployment/routes och D1 Write när remote migration körs. Eftersom Worker-konfigurationen innehåller Secrets Store-bindings kräver Cloudflare dessutom Secrets Store Write på deploytokenet. W1 distribueras inte till observationsruntime som providercredential.

`0005_observations.sql` använder `CREATE TABLE/INDEX IF NOT EXISTS` och är därför avsiktligt idempotent för denna driftväg.

## Deploymentgräns

`npm run deploy` är en explicit produktionsåtgärd. Kodmerge, D1 migration, secret-provisionering, provider-permissionändringar och Worker deployment är separata steg och ska verifieras var för sig.
