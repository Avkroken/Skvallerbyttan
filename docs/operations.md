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

Runtime använder:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN_R1` — Secrets Store-binding, Platform / Resource Read
- `CLOUDFLARE_API_TOKEN_R2` — Secrets Store-binding, Analytics / Observability / Operations Read
- `CLOUDFLARE_API_TOKEN_R3` — Secrets Store-binding, Security / Identity Read
- `CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET`
- `CLOUDFLARE_CASB_WEBHOOK_SECRET`
- `SKVALLERBYTTAN_READ_API_TOKEN` — valfri machine read API

Secrets Store-bindningarna hämtar värdet asynkront med `get()`. Under migration/lokal utveckling stöder koden det äldre `CLOUDFLARE_API_TOKEN` och `SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN` som fallback när en klassbinding saknas.

GitHub Actions som muterar Cloudflare använder `CLOUDFLARE_API_TOKEN_W1`. W1 ska inte synkas till Worker-runtime som observationscredential.

### Runtime secret-sync

`.github/workflows/sync-cloudflare-runtime-secrets.yml` är endast `workflow_dispatch` och delar concurrency-grupp med produktionsdeploy.

Workflowen använder W1 för Wrangler-operationen och synkar endast Worker-secrets som inte är providercredentials:

- `CLOUDFLARE_ACCOUNT_ID`
- Notifications webhook secret
- CASB webhook secret
- valfri machine read API-token

R1/R2/R3 kopieras inte längre från GitHub Organization Secrets. De bindas direkt från Cloudflare Secrets Store genom `wrangler.jsonc`.

Webhook-secret för Notifications och CASB måste vara separata.

Deploy av en Worker med Secrets Store-bindings kräver enligt Cloudflare **Secrets Store Write** på API-tokenet som Wrangler använder. Produktionsdeploy är därför blockerad tills W1 har den permissionen eller deploymodellen ändras.

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

Workflowen använder W1 genom `CLOUDFLARE_API_TOKEN_W1` när credentialen är provisionerad. Under migrationen finns fallback till det äldre `CLOUDFLARE_API_TOKEN`.

W1 behöver täcka Worker deployment/routes och D1 Write när remote migration körs. Eftersom Worker-konfigurationen innehåller Secrets Store-bindings kräver Cloudflare dessutom Secrets Store Write på deploytokenet. W1 distribueras inte till observationsruntime som providercredential.

`0005_observations.sql` använder `CREATE TABLE/INDEX IF NOT EXISTS` och är därför avsiktligt idempotent för denna driftväg.

## Deploymentgräns

`npm run deploy` är en explicit produktionsåtgärd. Kodmerge, D1 migration, secret-provisionering, provider-permissionändringar och Worker deployment är separata steg och ska verifieras var för sig.
