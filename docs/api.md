---
layout: default
title: API
permalink: /api/
---

# API

## Kontrakt

Canonical observations-API ligger under `/api/v1`. Schema-version är **1** och returneras även i header `X-Skvallerbyttan-Schema-Version`.

Capability keys, statusvokabulär, provenance och effective-state representation betraktas som maskinkonsumerade kontrakt och skyddas av tester.

## Auth

Alla API-routes är privata och GET-only. Machine bearer-auth gäller endast `/api/v1/*`; äldre dashboard-API kräver interaktiv session.

Godkänd auth:

1. aktiv Skvallerbyttan-dashboard-session → consumer `dashboard`
2. `Authorization: Bearer <SKVALLERBYTTAN_READ_API_TOKEN>` → consumer `chatgpt`

Bearer-token ger inte interaktiv asset/session-access.

## Core routes

### Capabilities och health

- `GET /api/v1/capabilities`
- `GET /api/v1/provider-health`
- `GET /api/v1/reads?days=30`

### GitHub

- `GET /api/v1/github/org/state`
- `GET /api/v1/github/repos/:repo/effective-policy`

Organization state innehåller read-only Actions permissions, Custom Properties och security configurations. Actions Policies och organization Rulesets rapporterar blockerad state när providern kräver write permission.

Repository effective policy innehåller:

- effective/direct/inherited rulesets
- repository Actions permissions
- Custom Property values
- effective security configuration när provider/API/permission tillåter det
- provenance och explicit unknown/not-exposed relationer

### Cloudflare

- `GET /api/v1/cloudflare/account`
- `GET /api/v1/cloudflare/zones`
- `GET /api/v1/cloudflare/workers`
- `GET /api/v1/cloudflare/storage/d1`
- `GET /api/v1/cloudflare/storage/kv`
- `GET /api/v1/cloudflare/storage/r2`
- `GET /api/v1/cloudflare/zero-trust/access`
- `GET /api/v1/cloudflare/zero-trust/tunnels`
- `GET /api/v1/cloudflare/audit?days=7`

Storage-routes returnerar inventory/metadata, inte database rows, KV values eller R2 objects.

Audit returnerar minimerad actor/action/resource-metadata och explicit coverage.

### Activity

`GET /api/v1/activity`

Filter:

- `days`
- `provider`
- `capability`
- `repository`
- `resource`

Responsen skiljer mellan grouped observed counts, coverage och recent event stream.

## Status

Gemensam statusvokabulär:

- `available`
- `unavailable`
- `permission_denied`
- `not_configured`
- `not_supported`
- `not_exposed_by_provider`
- `unknown`
- `not_observed`
- `stale`
- `error`

## Freshness

Cache-backed routes returnerar cacheheaders. Capability-registret exponerar `lastAttemptAt`, `lastSuccessAt`, `freshness`, last HTTP status och sanerad last error.

## Raw data

Det finns inget generellt raw/debug provider-endpoint. Providerdata reduceras innan API-respons. Secrets och credentialvärden får aldrig returneras.
