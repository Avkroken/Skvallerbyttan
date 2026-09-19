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

Skvallerbyttan är Avkrokens centrala **read-only observationslager** för GitHub och Cloudflare. Dashboard och machine API delar samma canonical normaliserade state.

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
- **GitHub webhook:** eventdriven Activity, security ledger och cache invalidation.

GitHub REST API-version: `2026-03-10`.

Viktig providerbegränsning: list/get av Actions Policies och organization Rulesets kräver write-klassad Administration-permission. Den permissionen ingår inte i Skvallerbyttans arkitektur. Dessa capabilities ska därför visa read-only blocker/permission denied. Repository effective rulesets används där de kan observeras med mindre privilegium.

## Cloudflare

Canonical Cloudflare runtime bindings använder Avkrokens organization-wide `CLOUDFLARE_*`-namn. GitHub organization secrets är credential-källa; en separat manuell secret-sync workflow transporterar värden till Worker-runtime utan att de behöver exponeras eller kopieras av en operatör. Transporttoken är skild från provider read-token och används aldrig av observationskoden.

Read-only provider client omfattar:

- Account
- Zones
- Workers
- D1 inventory
- KV namespace inventory
- R2 bucket inventory
- Access applications
- Tunnels
- Notifications
- CASB
- Audit Logs
- Analytics Engine SQL för read telemetry

Ingen Cloudflare-plugin var tillgänglig under implementationen, så den faktiska nuvarande token-permissionmängden kunde inte verifieras externt. Runtime capability observations ska därför avgöra `granted` kontra `permission_denied` efter deployment.

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
