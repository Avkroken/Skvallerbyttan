---
layout: default
title: Skvallerbyttan
permalink: /
---

# Skvallerbyttan

Skvallerbyttan är Avkrokens privata read-only observationslager för GitHub och Cloudflare. Dashboard och maskinklienter använder samma canonical normaliserade state.

Den körande tjänsten finns på **[skvallerbyttan.denied.se](https://skvallerbyttan.denied.se)**. Den här GitHub Pages-ytan är publik dokumentation och innehåller därför inga hemligheter eller privat live-state.

## Dokumentationskatalog

| Område | Innehåll |
| --- | --- |
| [Arkitektur]({{ '/architecture/' | relative_url }}) | Provider-adapters, canonical state, cache, D1, Analytics Engine och reconciliation. |
| [API]({{ '/api/' | relative_url }}) | Versionerat normaliserat API, auth, schema och routes. |
| [Permissions]({{ '/permissions/' | relative_url }}) | GitHub- och Cloudflare-permissionmatriser och read-only-gräns. |
| [Drift]({{ '/operations/' | relative_url }}) | Migrationer, retention, metrics, reconciliation och verifiering. |
| [Säkerhet]({{ '/security/' | relative_url }}) | Auth, machine access, raw-data-policy och webhookintegritet. |
| [Projektkontext]({{ '/project-context/' | relative_url }}) | Verifierad repository- och arkitekturkontext. |

## Dashboard

Dashboarden har fem toppnivåer:

- **Översikt** — säkerhet, CI, PR/issues, attention och providerstatus.
- **GitHub** — repository-, Actions-, security- och governance-state.
- **Cloudflare** — account, zones, Workers, Storage, Zero Trust och Audit Logs.
- **Aktivitet** — observerade events med coverage, source och tidsfilter.
- **Insyn** — capabilities, permissions, freshness, Reads, health och providerbudget.

Observerad Activity och Skvallerbyttans Reads är olika metrics och visas separat.

## Epistemisk modell

Skvallerbyttan skiljer mellan live/cached/derived state och använder explicita statusar som `stale`, `not_observed`, `permission_denied`, `not_exposed_by_provider` och `unknown`. En frånvarande eller gammal observation får inte presenteras som verifierad live-state.
