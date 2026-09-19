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

## Cache och schemalagd reconciliation

Normal source-cache-TTL är sex timmar. En webhook invaliderar `overview` och, när ett repository kan identifieras, även dess repository- och insightscache.

Wrangler-konfigurationen kör en schemalagd reconciliation:

```text
0 */6 * * *
```

Den uppdaterar organisationsöversikten och rensar webhookleveranser äldre än sju dagar. Detta är säkerhetsnätet om en webhook fördröjs eller missas.

## D1

D1-bindningen heter `STATS_DB`. Repositoryt innehåller följande migrationsserier:

- `0001_statistics_history.sql`
- `0002_api_cache.sql`
- `0003_security_events.sql`

Migrationer och live-databasändringar ska behandlas som driftändringar och inte appliceras implicit av dokumentationsarbete.

## GitHub Pages

Publik projektdokumentation byggs från `docs/` genom repositoryts Pages-caller och Avkrokens centrala reusable workflow. Pages-deployment är separat från Cloudflare-deploymenten av dashboarden.
