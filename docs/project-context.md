---
layout: default
title: Projektkontext
permalink: /project-context/
---

# Projektkontext

Senast verifierad för observationslagerarbetet: 2026-09-19.

## Repository

- repository: `Avkroken/Skvallerbyttan`
- default branch: `main`
- runtime: TypeScript Cloudflare Worker
- production domain: `https://skvallerbyttan.denied.se`
- dashboard: privat
- repository/Pages docs: publika
- full repository check: `npm run check`

Avkroken/.github är central källa för organisationsgemensam engineering-, CI- och governance-kontext.

## Produktansvar

Skvallerbyttan är Avkrokens centrala **read-only observationslager och eventnav** för GitHub och Cloudflare. Dashboard och machine API delar samma canonical normaliserade state. Provider-webhooks ska termineras här; andra Avkroken-tjänster reagerar via interna signaler i stället för att skapa parallella provider-integrationer.

`Avkroken/.github` är central organisations-/engineeringkälla och `avkroken.denied.se` är fronten. Skvallerbyttan är underförrådet som äger eventström, Activity och samlad historik.

Skvallerbyttan är inte ett administrativt provider-API.

## Dashboard

Top-level navigation:

1. Översikt
2. GitHub
3. Cloudflare
4. Aktivitet
5. Insyn

Navigationen är tangentbordsnavigerbar, deep-linkbar och data lazy-laddas per flik.

## GitHub integrationer

- **Gamnacke:** GitHub App för provider-reads.
- **Krösa-Maja:** OAuth login för människan.
- **GitHub organization webhook:** canonical event-ingress för Activity, security ledger och cache invalidation.
- **Avkroken portal signal:** docs-relevanta GitHub-events skickas internt via Cloudflare Service Binding `AVKROKEN_PORTAL_DOCS` till `avkroken-portal`/`DocsInvalidationService`; portalen behöver därmed ingen egen provider-webhook för detta.

GitHub REST API-version: `2026-03-10`.

Viktig providerbegränsning: list/get av Actions Policies och organization Rulesets kräver write-klassad Administration-permission. Den permissionen ingår inte i Skvallerbyttans arkitektur. Dessa capabilities ska därför visa read-only blocker/permission denied. Repository effective rulesets används där de kan observeras med mindre privilegium.

## Cloudflare

Skvallerbyttans Cloudflare-provider är read-only och följer Avkrokens centrala credentialmodell i `Avkroken/.github/docs/cloudflare-credential-standard.md`.

Provider-reads är partitionerade och rangordnade utan arv:

- **R1 — Platform / Resource Read:** Zones, Workers, D1 inventory, KV namespace inventory och R2 bucket inventory.
- **R2 — Analytics / Content / Operations Read:** Account, Notifications, Audit Logs och Analytics Engine SQL för read telemetry.
- **R3 — Security / Identity Read:** Access applications, Tunnels och CASB.

Runtime binder `CLOUDFLARE_API_TOKEN_R1`, `CLOUDFLARE_API_TOKEN_R2` och `CLOUDFLARE_API_TOKEN_R3` direkt från Cloudflare Secrets Store utan generisk tokenfallback.

GitHub Actions som muterar Cloudflare använder W1-credentialen när den finns. Runtime-secret-sync kopierar inte längre R1/R2/R3 från GitHub till vanliga Worker secrets.

Cloudflare-account-ID är versionerad icke-hemlig config. GitHub- och Cloudflare-webhooks använder var sitt canonical secret; Notifications och CASB delar Cloudflare-webhooksecretet. Cloudflare Notifications och CASB är canonical push-ingress för Cloudflare-event som providern exponerar den vägen. Audit Logs och reconciliation täcker resterande observerbara ändringar. Observationskoden använder inga provider-write-operationer.

## Interna event-signaler

Downstream-tjänster får inte behöva duplicera providerautentisering enbart för cache/freshness-signaler.

För publik repositorydokumentation:

1. GitHub levererar `push`/`repository` till Skvallerbyttan.
2. Skvallerbyttan verifierar webhooksignaturen och organisationsgränsen.
3. Relevanta docs-events signaleras till `avkroken-portal` genom den interna Service Bindingen `AVKROKEN_PORTAL_DOCS`.
4. Portalens `DocsInvalidationService` purgar endast `docs-catalog` och berörda `docs-repo-*` cache-tags.
5. Activity/deduplication ligger fortsatt i Skvallerbyttan; portalen blir inte ett parallellt eventlager.

Service Bindingen är intern Cloudflare-RPC och kräver ingen separat webhook-secret.

## Data

D1 används för persistent state, cache, detailed events och reconciliation state. Migration `0005_observations.sql` introducerar capability observations och generic Activity ledger.

Workers Analytics Engine dataset `skvallerbyttan_observability` tar read telemetry med consumer-attribution.

## API

Canonical kontrakt ligger under `/api/v1`. Det kan läsas av:

- autentiserad dashboard-session
- machine bearer-token `SKVALLERBYTTAN_READ_API_TOKEN`

Machine access är GET-only och attribueras consumer `chatgpt`.

## Epistemisk modell

Data ska aldrig implikera högre säkerhet än källan stödjer.

- provider current state är högst prioritet
- stale cache är explicit stale
- Activity betyder observerad aktivitet
- derived relationer markeras derived
- provider gaps använder `not_exposed_by_provider` eller `permission_denied`
- frånvaro av observation använder `not_observed` eller `unknown`

## Metrics och kostnad

Read telemetry ligger i Analytics Engine; detailed events ligger i D1.

Analytics Engine har tre månaders retention. SQL-queries väger `_sample_interval` för sampled data. Nuvarande faktiska volume/cost kan först verifieras efter deployment och ska inte uppskattas som live-fakta i förväg.

## Deploymentstatus för detta arkitekturarbete

Repositorykod och dokumentation kan mergeas utan att automatiskt:

- migrera produktions-D1
- skapa machine token
- ändra GitHub App permissions
- ändra Cloudflare API-token permissions
- deploya Worker

Dessa är separata efterföljande driftåtgärder.
