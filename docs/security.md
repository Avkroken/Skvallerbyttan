---
layout: default
title: Säkerhet
permalink: /security/
---

# Säkerhet

## Hård gräns: read-only

Skvallerbyttan observerar GitHub och Cloudflare men administrerar dem inte. Observationslagret får inte lägga till write-permissions för att kringgå en providerbegränsning.

Det innebär bland annat att Skvallerbyttan inte kan ändra rulesets, Actions policies, Custom Properties, repository settings, security configurations, Workers, Zero Trust, DNS, Cloudflare policies eller secrets.

GitHubs Actions Policy- och organization Ruleset-GET kräver för närvarande write-klassad Administration-permission. Dessa capabilities lämnas därför explicit otillgängliga i stället för att ge Skvallerbyttan write-access.

## Interaktiv auth

Dashboarden använder GitHub OAuth via Krösa-Maja:

- scope `read:user`
- OAuth state
- PKCE S256
- allowlist med numeriska GitHub-ID:n
- `__Host-` cookies med `HttpOnly`, `Secure`, `SameSite=Lax`
- signerad lokal session med högst 12 timmars TTL

OAuth-token används endast för identitetsuppslag och lagras inte.

## Machine read API

`/api/*` kan autentiseras med vanlig dashboard-session eller med en separat bearer-secret i `SKVALLERBYTTAN_READ_API_TOKEN`.

Machine-token:

- ger endast GET-access till `/api/v1/*`
- ger inte assets/dashboard-session
- attribueras consumer `chatgpt`
- ska lagras som Worker secret
- returneras aldrig av något API

Alla API-responser använder privata/no-store cacheheaders.

## GitHub provider auth

Gamnacke används som GitHub App. Worker skapar App-JWT och kortlivat installation token. Providerpermissions ska följa minsta möjliga read-nivå; se [Permissions]({{ '/permissions/' | relative_url }}).

## Cloudflare provider auth

Cloudflare-providerreads använder tre separata read-klasser enligt Avkrokens centrala credentialstandard:

- **R1:** platform/resource reads.
- **R2:** analytics/observability/operations reads.
- **R3:** security/identity reads.

Klasserna är partitionerade och rangordnade utan arv. Ett R3-token ersätter därför inte R1 eller R2.

Worker-runtime stödjer `CLOUDFLARE_API_TOKEN_R1`, `CLOUDFLARE_API_TOKEN_R2` och `CLOUDFLARE_API_TOKEN_R3`. Under migrationen kan det äldre `CLOUDFLARE_API_TOKEN` och därefter `SKVALLERBYTTAN_CLOUDFLARE_API_TOKEN` användas som fallback om den begärda klassen ännu inte är provisionerad.

Produktionsdeploy och explicit secret-sync använder W1 som operationscredential när `CLOUDFLARE_API_TOKEN_W1` finns i GitHub organization secrets. W1 distribueras inte till observationsruntime som providercredential.

Observationskoden får inte använda W1/O1 som fallback vid 403. En saknad providerpermission ska i stället rapporteras som capability-/permission-state.

Skvallerbyttan läser inte D1-tabellinnehåll, KV values eller R2 object content som del av observationsinventeringen.

## Raw-data-policy

Provideradapters får läsa providerresponser internt men externa modeller minimeras.

API:t får inte returnera:

- token- eller secret-värden
- privata nycklar
- Authorization headers
- webhook-secrets
- Worker secret bindings
- KV values eller R2 object contents
- upptäckta secret-scanning-hemligheter
- råa Audit Log request/response payloads
- Cloudflare Audit actor IP/token metadata

Audit Log-normalisering har regressionstest för dessa gränser.

## Webhooks

### GitHub

`/webhooks/github` kräver POST, konfigurerat secret och giltig `X-Hub-Signature-256`. Delivery-ID dedupliceras innan ledger/cache uppdateras.

### Cloudflare Notifications

`/webhooks/cloudflare/notifications` använder separat `cf-webhook-auth` secret.

### Cloudflare CASB

`/webhooks/cloudflare/casb` använder separat statisk header `x-skvallerbyttan-casb-auth`.

Godtyckliga webhookpayloads lagras inte. Endast explicit normaliserad metadata går till D1.

## Public/private boundaries

Publika drift/auth endpoints:

- `/health`
- `/healthz`
- `/ready`
- `/login`
- OAuth callback/start/logout
- verifierade webhookendpoints

Dashboard-assets och API-state är privata. Svar sätter `noindex`/säkerhetsheaders; noindex är inte access control.

## Logging

Fel loggas utan credentials. Capability `lastError` klipps och ska innehålla status/orsak, inte providerrawdata eller secret material.
