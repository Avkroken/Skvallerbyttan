---
layout: default
title: Drift
permalink: /operations/
---

# Drift

## Lokal verifiering

Repositoryts normala verifieringskommando är:

```bash
npm ci
npm run check
```

`npm run check` kör:

1. testsviten,
2. TypeScript typecheck,
3. `wrangler deploy --dry-run`.

Det verifierar kod och Worker-konfiguration utan att göra en produktionsdeployment.

## Deploymentgräns

Produktionsdeployment görs med `npm run deploy`, som anropar Wrangler. Deployment och förändringar av Cloudflare-resurser är separata driftåtgärder och ska inte göras som bieffekt av dokumentations- eller repositoryunderhåll.

Den faktiska tjänsten körs på:

```text
https://skvallerbyttan.denied.se
```

## Hälsokontroller

Worker-koden exponerar:

- `GET /health`
- `GET /healthz`
- `GET /ready`

`/health` och `/healthz` bekräftar att Worker-routen svarar. `/ready` verifierar att de konfigurationsvärden som krävs för GitHub App och autentisering finns tillgängliga; den returnerar annars 503.

## GitHub webhook

Organisationens webhook för Skvallerbyttan använder:

```text
https://skvallerbyttan.denied.se/webhooks/github
```

För webhooken gäller:

- content type: `application/json`
- SSL verification: på
- secret: samma hemliga värde som Worker-secreten `SKVALLERBYTTAN_WEBHOOK_SECRET`
- signatur: `X-Hub-Signature-256`
- delivery-ID: `X-GitHub-Delivery`

Hemligheten dokumenteras aldrig med sitt faktiska värde.

Den aktuella rekommenderade event-prenumerationen för dashboardens använda data är:

- `code_scanning_alert`
- `dependabot_alert`
- `deployment`
- `deployment_status`
- `fork`
- `issues`
- `pull_request`
- `pull_request_review`
- `push`
- `release`
- `repository`
- `repository_ruleset`
- `secret_scanning_alert`
- `star`
- `workflow_run`

Worker-koden känner även igen fler GitHub-event för cacheinvalidering om de levereras, men extra event ska inte prenumereras på enbart för säkerhets skull. Prenumerationen ska följa den data dashboarden faktiskt använder.

Webhookflödet:

1. kräver POST,
2. verifierar HMAC-SHA256-signaturen,
3. validerar event- och delivery-headers,
4. ignorerar händelser från andra organisationer,
5. deduplicerar leveranser via delivery-ID,
6. registrerar relevant säkerhetsmetadata,
7. invaliderar berörda source-cache-nycklar.

## Cloudflare webhooks och read-only API

Cloudflare Notifications använder destinationen:

```text
https://skvallerbyttan.denied.se/webhooks/cloudflare/notifications
```

Konfigurera destinationen som en generic webhook med ett separat secret. Samma värde ska finnas i Worker-secreten `SKVALLERBYTTAN_CLOUDFLARE_NOTIFICATIONS_WEBHOOK_SECRET`. Cloudflare skickar värdet i `cf-webhook-auth`; requests utan korrekt värde avvisas.

Cloudflare One CASB använder destinationen:

```text
https://skvallerbyttan.denied.se/webhooks/cloudflare/casb
```

Välj **Static Headers** och konfigurera:

- header: `x-skvallerbyttan-casb-auth`
- värde: samma hemliga värde som Worker-secreten `SKVALLERBYTTAN_CLOUDFLARE_CASB_WEBHOOK_SECRET`

För read-only Cloudflare API krävs dessutom runtimevärdena:

- `SKVALLERBYTTAN_CLOUDFLARE_ACCOUNT_ID`
- `SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN`

API-tokenet ska begränsas till det aktuella kontot och endast ha `Notifications Read` och `Zero Trust Read`. Klienten gör endast GET-anrop. Den läser Notifications-historik, policyer, Notifications-webhookstatus och CASB-webhookkonfiguration.

Cloudflare-funktionerna exponeras bakom vanlig dashboardautentisering:

- `GET /api/cloudflare/activity`
- `GET /api/cloudflare/notifications/history`
- `GET /api/cloudflare/notifications/policies`
- `GET /api/cloudflare/notifications/webhooks`
- `GET /api/cloudflare/casb/webhooks`

Webhook-URL:er, secrets och header-värden tas bort ur API-resultaten innan de returneras till dashboarden.

## Cache och schemalagd reconciliation

Normal source-cache-TTL är sex timmar. En webhook invaliderar `overview` och, när ett repository kan identifieras, även dess repository- och insightscache.

Wrangler-konfigurationen kör en schemalagd reconciliation:

```text
0 */6 * * *
```

Den uppdaterar GitHub-organisationsöversikten, uppdaterar Cloudflare-källorna när API-konfigurationen finns, rensar webhookleveranser äldre än sju dagar och Cloudflare-event äldre än 90 dagar. Detta är säkerhetsnätet om en webhook fördröjs eller missas.

## D1

D1-bindningen heter `STATS_DB`. Repositoryt innehåller följande migrationsserier:

- `0001_statistics_history.sql`
- `0002_api_cache.sql`
- `0003_security_events.sql`
- `0004_cloudflare_events.sql`

Migrationer och live-databasändringar ska behandlas som driftändringar och inte appliceras implicit av dokumentationsarbete.

## GitHub Pages

Publik projektdokumentation byggs från `docs/` genom repositoryts Pages-caller och Avkrokens centrala reusable workflow. Pages-deployment är separat från Cloudflare-deploymenten av dashboarden.
