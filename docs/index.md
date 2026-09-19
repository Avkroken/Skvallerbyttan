---
layout: default
title: Skvallerbyttan
permalink: /
---

# Skvallerbyttan

Skvallerbyttan är Avkrokens privata dashboard för att följa GitHub-hälsa, säkerhet, leverans och repositorystatistik på organisations- och repositorynivå.

Den körande tjänsten finns på **[skvallerbyttan.denied.se](https://skvallerbyttan.denied.se)**. Den här GitHub Pages-webbplatsen är en separat, publik dokumentationsyta och innehåller därför inga hemligheter eller privat driftdata.

## Dokumentationskatalog

| Område | Innehåll |
| --- | --- |
| [Arkitektur]({{ '/architecture/' | relative_url }}) | Runtime, GitHub-integrationer, dataflöde, cache och D1. |
| [Drift]({{ '/operations/' | relative_url }}) | Lokal verifiering, webhook, schemalagd reconciliation, hälsokontroller och deploymentgräns. |
| [Säkerhet]({{ '/security/' | relative_url }}) | Autentisering, sessionsmodell, webhookverifiering och publik dokumentationsgräns. |
| [Projektkontext]({{ '/project-context/' | relative_url }}) | Verifierad current state för repository, CI, rulesets och Pages. |
| [Repository](https://github.com/Avkroken/Skvallerbyttan) | Källkod, issues och pull requests. |

## Vad dashboarden gör

Skvallerbyttan hämtar GitHub-data genom en installerad GitHub App och sammanställer bland annat öppna issues och pull requests, Actions-hälsa, säkerhetsalerts, repositorydetaljer, historik och operativa signaler. Webhooks används för att invalidera berörd cache snabbt, medan en schemalagd reconciliation körs som säkerhetsnät.

Dashboarden är inte en publik statusportal. Användaren loggar in med GitHub via Krösa-Maja och måste dessutom finnas i tjänstens uttryckliga allowlist.

## Källor och ansvar

- **Applikationskod:** repositoryts `src/` och `public/`.
- **Cloudflare-konfiguration:** `wrangler.jsonc`.
- **Databasändringar:** `migrations/`.
- **Publik projektdokumentation:** `docs/`.
- **Repository-specifik current state:** `docs/project-context.md`.
- **Säkerhetsrapportering:** repositoryts `SECURITY.md`.

När implementation eller driftarkitektur ändras ska dokumentationen uppdateras tillsammans med ändringen så att den beskriver faktisk current state.
