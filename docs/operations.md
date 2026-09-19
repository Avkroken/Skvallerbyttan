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

Nya runtime-secrets för observationslagret:

- `SKVALLERBYTTAN_READ_API_TOKEN` — machine read API; optional tills machine access aktiveras
- Avkrokens befintliga `CLOUDFLARE_ACCOUNT_ID`
- Avkrokens befintliga read-only `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET`
- `CLOUDFLARE_CASB_WEBHOOK_SECRET`

De fyra `CLOUDFLARE_*`-namnen är canonical både i Avkrokens GitHub organization secrets och i Worker-runtime. De äldre `SKVALLERBYTTAN_CLOUDFLARE_*`-namnen finns endast som tillfälliga kodalias under migreringen och ska inte nyprovisioneras.

Om machine API ska aktiveras är `SKVALLERBYTTAN_READ_API_TOKEN` canonical med samma namn som GitHub organization secret och Worker secret. Secret-syncen tar med den om org-secretet finns, men failar inte om machine access ännu inte är provisionerad.

### Secret ownership och rotation

GitHub organization secrets är canonical källa för de befintliga Cloudflare-credentialsen. Ett dolt org-secret ska inte roteras enbart för att någon behöver kopiera värdet till Cloudflare.

`.github/workflows/sync-cloudflare-runtime-secrets.yml` är den explicita transportvägen. Den läser de befintliga org-secretsen och synkar dem till Worker-runtime utan att operatören behöver se eller kopiera värdena.

Secret-sync återanvänder det befintliga `CLOUDFLARE_API_TOKEN`. När sync eller annan explicit Wrangler-drift kräver högre Cloudflare-behörighet höjs behörigheten temporärt på samma token, jobbet körs och verifieras, och tokenets behörighet sänks därefter tillbaka till den normala read-only-nivån. Ingen extra transporttoken och inget extra org-secret skapas.

Secret-sync är endast `workflow_dispatch`. Det är avsiktligt: `wrangler secret bulk` skapar en ny Worker-version och deployar den direkt, så sync är en explicit produktionsåtgärd och inte en PR-gate eller vanlig merge-side-effect. Secret-sync och ordinarie produktionsdeploy delar concurrency-gruppen `skvallerbyttan-production`, så de kan inte mutera produktionen parallellt.

Rotations-/syncflödet är därför:

1. höj vid behov behörigheten temporärt på befintligt `CLOUDFLARE_API_TOKEN`,
2. kör **Sync Cloudflare runtime secrets**,
3. verifiera workflowets secret-list och Skvallerbyttans provider health/capabilities,
4. sänk tokenets behörighet tillbaka till read-only.

Webhook-secret för Notifications och CASB måste vara separata. Workflowet failar stängt om de är samma värde.

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

`0005_observations.sql` använder `CREATE TABLE/INDEX IF NOT EXISTS` och är därför avsiktligt idempotent för denna driftväg.

För en full körning med migration behöver det befintliga `CLOUDFLARE_API_TOKEN` temporärt kunna:

- deploya befintlig Worker: Workers/Worker **Editor** / motsvarande Workers Scripts Write,
- skriva D1-schema: **D1 Edit**,
- uppdatera Worker Custom Domain vid behov: **Workers Routes Write** för berörd zon.

När migration inte ska köras behövs inte D1 Edit för själva deploysteget. Tokenets normala observationsrättigheter ska återställas till read-only efter verifierad drift. Ingen separat deploy-token ska skapas enbart för detta jobb.

## Deploymentgräns

`npm run deploy` är en explicit produktionsåtgärd. Kodmerge, D1 migration, secret-provisionering, provider-permissionändringar och Worker deployment är separata steg och ska verifieras var för sig.
