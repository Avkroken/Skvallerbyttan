---
layout: default
title: Säkerhet
permalink: /security/
---

# Säkerhet

Den här sidan beskriver Skvallerbyttans tekniska säkerhetsgränser. Instruktioner för privat rapportering av sårbarheter finns i repositoryts [SECURITY.md](https://github.com/Avkroken/Skvallerbyttan/blob/main/SECURITY.md).

## Privat dashboard

Dashboarden är inte publik. Applikationsassets och API-data ligger bakom Skvallerbyttans egen autentisering. `noindex`-headers och robots-konfiguration minskar oavsiktlig indexering men är inte åtkomstkontroll; åtkomstkontrollen sker i Worker-koden.

Autentiserade assets skickas med privata cacheheaders och säkerhetsheaders, bland annat CSP, `X-Content-Type-Options`, `X-Frame-Options` och `Referrer-Policy`.

## Användarinloggning

Användarinloggningen går genom Krösa-Maja som GitHub OAuth-applikation.

Flödet använder:

- OAuth `state` för requestkoppling,
- PKCE med S256,
- scope `read:user`,
- en uttrycklig allowlist av numeriska GitHub-ID:n,
- `__Host-`-cookies med `HttpOnly`, `Secure` och `SameSite=Lax`.

Efter OAuth-callback används access-tokenet endast för att läsa GitHub-identiteten. Tokenet lagras inte av Skvallerbyttan och koden försöker återkalla det efter identitetsuppslaget.

Den lokala sessionen är ett HMAC-signaturverifierat payload med högst tolv timmars livslängd. En användare måste fortfarande finnas i allowlisten när sessionen verifieras.

## Tjänstens GitHub-åtkomst

Dashboardens serviceåtkomst är separerad från användarinloggningen. Gamnacke används som GitHub App och Skvallerbyttan mintar kortlivade installation tokens för API-anrop.

GitHub App-behörigheter bestäms av den installerade appens konfiguration. Dashboarden hanterar nekade frivilliga API-kapabiliteter som otillgängliga i stället för att försvaga åtkomstgränsen.

## Webhookintegritet

GitHub-webhooken kräver:

- POST,
- ett konfigurerat webhook-secret,
- giltig `X-Hub-Signature-256`,
- `X-GitHub-Event`,
- `X-GitHub-Delivery`.

Signaturen verifieras med HMAC-SHA256 innan payloaden används. Delivery-ID dedupliceras och payloads från andra organisationer ignoreras.

## Cloudflare webhookintegritet

Cloudflare-integrationen återanvänder inte GitHubs webhook-secret.

- **Cloudflare Notifications** kräver ett separat secret i `cf-webhook-auth` och jämför värdet innan payloaden tolkas.
- **Cloudflare One CASB** använder den dokumenterade autentiseringsmetoden **Static Headers** med headern `x-skvallerbyttan-casb-auth` och ett separat Worker-secret.
- CASB HMAC-Signing används inte i denna implementation eftersom Cloudflares publika dokumentation anger stöd och `signing_secret`, men inte ett verifierbart wire-format/signaturheader för mottagarsidan. Ingen signaturmodell gissas.
- Leveranser dedupliceras innan eventmetadatan skrivs till D1.

CASB-payloadens `metadata` och `data` lagras inte. Notifications-fältet `text` och alertspecificerad `data` lagras inte heller. Ledgern innehåller endast begränsad identifierande metadata som eventtyp, korrelations-/finding-ID, state, policy-ID och timestamps när de finns.

Cloudflare API-tokenet används endast för GET-anrop. Den avsedda permissionmängden är `Notifications Read` och `Zero Trust Read`; inga write-permissions krävs av klienten.

## Secrets och D1

Runtime-secrets deklareras som erforderliga i Wrangler-konfigurationen men deras faktiska värden ska endast finnas i den avsedda secret-store som används vid deployment. De ska inte skrivas till Git, issues, PR-kommentarer eller GitHub Pages.

D1-ledgern för GitHub-säkerhetshändelser lagrar metadata om alerts, inte själva upptäckta hemligheten. Cloudflare-ledgern lagrar på motsvarande sätt endast normaliserad metadata och inte fulla webhookpayloads.

## Publik GitHub Pages-dokumentation

Allt under den publicerade Pages-ytan ska betraktas som offentligt. Där får vi dokumentera arkitektur, publika endpoints, komponentansvar och säkerhetsmodell, men inte:

- secrets eller tokens,
- privata nycklar,
- hemliga webhookvärden,
- känslig live-data,
- privata incidentdetaljer,
- privata runbooks eller åtkomstuppgifter.

GitHub Pages är dokumentationsyta och påverkar inte dashboardens autentiseringsmodell eller Cloudflare-produktionsdomän.
