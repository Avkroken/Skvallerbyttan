---
layout: default
title: Arkitektur
permalink: /architecture/
---

# Arkitektur

## Översikt

Skvallerbyttan är en TypeScript-baserad Cloudflare Worker med statiska dashboard-assets. Worker-entrypointen är `src/entry.ts`, den huvudsakliga request- och scheduled-logiken finns i `src/worker.ts`, och `wrangler.jsonc` binder runtime-resurserna.

```text
Webbläsare
   │
   │ GitHub OAuth via Krösa-Maja
   ▼
Skvallerbyttan Worker
   ├── privata dashboard-assets
   ├── API för GitHub- och Cloudflare-data, historik och säkerhetsaktivitet
   ├── GitHub App-klient via Gamnacke
   ├── read-only Cloudflare API-klient
   ├── separata GitHub-, Notifications- och CASB-webhookmottagare
   └── D1
        ├── snapshots / historik
        ├── API-cache
        ├── webhookleveranser
        ├── GitHub-säkerhetshändelser
        └── normaliserade Cloudflare-events
```

## Runtime

`wrangler.jsonc` definierar:

- Worker-namnet `skvallerbyttan`.
- `src/entry.ts` som entrypoint.
- statiska assets från `public/`, med Worker-first-routing.
- D1-bindningen `STATS_DB`.
- custom domain `skvallerbyttan.denied.se`.
- en cron-trigger var sjätte timme.
- observability för loggar och traces.

`workers_dev` och preview-URL:er är avstängda i repositorykonfigurationen.

## GitHub-identiteter

Skvallerbyttan använder två separata GitHub-integrationer med olika ansvar:

### Gamnacke

Gamnacke används som GitHub App för tjänstens maskin-till-maskin-åtkomst till GitHub API. Worker-koden skapar ett kortlivat GitHub App-JWT, hämtar organisationens installation och mintar ett installation token. Tokenet cacheas endast i Worker-instansen och förnyas före utgång.

Den här identiteten används för att läsa den GitHub-data som dashboarden behöver.

### Krösa-Maja

Krösa-Maja används för användarinloggning genom GitHub OAuth. OAuth-flödet begär endast `read:user`, använder PKCE med S256 och verifierar användarens numeriska GitHub-ID mot en uttrycklig allowlist. OAuth-tokenet används för identitetsuppslag, lagras inte av Skvallerbyttan och återkallas efter callback-flödet.

## Cloudflare-integration

Cloudflare-integrationen har två separata datavägar:

1. **Push/event:** Cloudflare Notifications och Cloudflare One CASB skickar webhookhändelser till separata endpoints med separata secrets. Endast normaliserad metadata lagras i D1; godtyckliga alert- och finding-payloads lagras inte.
2. **Pull/current state:** en separat API-klient använder ett read-only Cloudflare API-token för att läsa Notifications-historik, Notifications-policyer, webhookdestinationers leveransstatus och CASB-webhookkonfiguration.

Cloudflare-läsningar cachelagras separat från GitHub-data. Webhookhändelser används som signaler för cacheinvalidering, medan API-läsningen förblir authoritative current state.

API-svaret för webhookdestinationer reduceras innan det når dashboarden: destinations-URL:er, secrets och header-värden exponeras inte.

## Dashboard-API

Den autentiserade Worker-routen exponerar bland annat:

- `GET /api/overview`
- `GET /api/security-activity`
- `GET /api/history`
- `GET /api/insights/:repo`
- `GET /api/repos/:repo`
- `GET /api/cloudflare/activity`
- `GET /api/cloudflare/notifications/history`
- `GET /api/cloudflare/notifications/policies`
- `GET /api/cloudflare/notifications/webhooks`
- `GET /api/cloudflare/casb/webhooks`

Repositorysegment valideras innan de används i GitHub-anrop eller D1-frågor.

## Cache och reconciliation

Översikts-, repository- och insightsdata lagras i en D1-baserad source cache. Normal cache-TTL är sex timmar.

GitHub-webhooks invaliderar bara de GitHub-cacheposter som berörs av händelsen. Cloudflare Notifications invaliderar motsvarande Notifications-historikcache. Nästa läsning kan då returnera den senast kända datan och starta en bakgrundsuppdatering. En schemalagd körning var sjätte timme uppdaterar GitHub-organisationsöversikten och, när Cloudflare API-konfiguration finns, de fyra Cloudflare-läsningarna som reconciliation. Den rensar även gamla webhookleveranser och Cloudflare-event enligt respektive retention.

Single-flight-logik används för att undvika parallella identiska refresh-anrop inom samma Worker-instans.

## Historik och säkerhetshändelser

D1-migrationerna skapar stöd för:

1. statistik- och repositorysnapshots,
2. API/source-cache,
3. säkerhetshändelser,
4. normaliserade Cloudflare-events.

Webhookhändelser för Code Scanning, Dependabot och Secret Scanning kan sparas i en separat ledger. Endast metadata som händelsetyp, repository, alertnummer, action, severity, paket/rule/secret-typ och resolution lagras; själva hemligheten lagras inte.

## Publik dokumentation

GitHub Pages är frikopplat från applikationsruntime. Pages bygger endast innehållet i `docs/` och får inte användas som alternativ produktionshost för dashboarden. Produktionsdomänen för tjänsten förblir `skvallerbyttan.denied.se`.
