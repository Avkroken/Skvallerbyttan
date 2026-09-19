---
layout: default
title: Permissions
permalink: /permissions/
---

# Permissions

Den här matrisen beskriver minsta provider-permissions för observationslagret. **Runtime permission state är inte samma sak som required permission.** Efter deployment registrerar capability-registret om credentialen faktiskt fick läsa endpointen.

## GitHub

| Capability | Endpoint | Minsta permission | Nivå | Skvallerbyttan |
| --- | --- | --- | --- | --- |
| repositories | `GET /orgs/{org}/repos` | installation/repository metadata access | read | implementerad |
| repository Actions | `GET /repos/{owner}/{repo}/actions/*` | Actions | read | implementerad |
| organization Actions permissions | `GET /orgs/{org}/actions/permissions*` | Administration (organization) | read | implementerad |
| Actions Policies / Workflow Execution Protections | `GET /orgs/{org}/actions/policies` | Administration (organization) | **write** | blockerad av read-only-policy |
| repository Actions Policies | `GET /repos/{owner}/{repo}/actions/policies` | Administration (repository) | **write** | blockerad av read-only-policy |
| organization Rulesets | `GET /orgs/{org}/rulesets` | Administration (organization) | **write** | blockerad av read-only-policy |
| repository effective rulesets | `GET /repos/{owner}/{repo}/rulesets?includes_parents=true` | Metadata (repository) | read | implementerad |
| Custom Property definitions/assignments | `GET /orgs/{org}/properties/*` | Custom properties (organization) | read | implementerad |
| repository Custom Property values | `GET /repos/{owner}/{repo}/properties/values` | Metadata (repository) | read | implementerad |
| security configurations | `GET /orgs/{org}/code-security/configurations*` | Administration (organization) | read | implementerad |
| security alerts | organization/repository scanning alert endpoints | Security events / Dependabot alerts as applicable | read | befintlig/implementerad |

Skvallerbyttan ska **inte** lägga till Administration write för Actions Policies eller organization Rulesets enbart för observation.

GitHub dokumenterar också att `bypass_actors` i ett repository ruleset bara returneras när anroparen har write-access till rulesetet. Skvallerbyttan använder därför `bypassActorsState: not_exposed_by_provider` när fältet är utelämnat; en tom exponerad lista är däremot `available` med noll aktörer. Ingen write-permission läggs till för att få fram bypasslistan.

Den faktiska Gamnacke-permissionmängden är runtime-state och ska verifieras genom capability observations efter deployment; den rekonstrueras inte från äldre dokument.

## Cloudflare

| Capability | Endpoint | Minsta token permission | Scope | Skvallerbyttan |
| --- | --- | --- | --- | --- |
| account | `GET /accounts/{id}` | Account Settings Read | account | implementerad |
| zones | `GET /zones?account.id=...` | Zone Read | zones/account | implementerad |
| Workers | `GET /accounts/{id}/workers/scripts` | Workers Scripts Read | account | implementerad |
| D1 inventory | `GET /accounts/{id}/d1/database` | D1 Read | account | implementerad |
| KV inventory | `GET /accounts/{id}/storage/kv/namespaces` | Workers KV Storage Read | account | implementerad |
| R2 inventory | `GET /accounts/{id}/r2/buckets` | Workers R2 Storage Read | account | implementerad |
| Access applications | `GET /accounts/{id}/access/apps` | Access: Apps and Policies Read | account | implementerad |
| Tunnels | `GET /accounts/{id}/tunnels` | Cloudflare Tunnel Read eller Cloudflare One Connectors Read | account | implementerad |
| Notifications | `GET /accounts/{id}/alerting/v3/*` | Notifications Read | account | befintlig/implementerad |
| CASB/Zero Trust | CASB read API/webhook config | Zero Trust Read | account | befintlig/implementerad |
| Audit Logs | `GET /accounts/{id}/logs/audit` | Account Settings Read | account | implementerad |
| read telemetry query | `POST /accounts/{id}/analytics_engine/sql` med SELECT | Account Analytics Read | account | implementerad |

Analytics Engine SQL använder POST som transport men operationen är read-only SELECT. Tokenet får inte få write-permissions för andra Cloudflare-resurser för denna funktion.

## Nuvarande permission-state

Cloudflare-tokenets och Gamnacke-installationens nya permissions kunde inte verifieras genom externa connectors i implementationssessionen. Därför ska initial state för ännu oobserverade capabilities vara `not_observed`/permission `unknown`. Första faktiska provideranrop uppdaterar state till exempelvis `granted` eller `permission_denied`.

Ingen permission ska dokumenteras som granted enbart för att den står i denna required-permission-matris.
