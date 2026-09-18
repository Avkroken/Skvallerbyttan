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

## Secrets och D1

Runtime-secrets deklareras som erforderliga i Wrangler-konfigurationen men deras faktiska värden ska endast finnas i den avsedda secret-store som används vid deployment. De ska inte skrivas till Git, issues, PR-kommentarer eller GitHub Pages.

D1-ledgern för säkerhetshändelser lagrar metadata om alerts, inte själva upptäckta hemligheten.

## Publik GitHub Pages-dokumentation

Allt under den publicerade Pages-ytan ska betraktas som offentligt. Där får vi dokumentera arkitektur, publika endpoints, komponentansvar och säkerhetsmodell, men inte:

- secrets eller tokens,
- privata nycklar,
- hemliga webhookvärden,
- känslig live-data,
- privata incidentdetaljer,
- privata runbooks eller åtkomstuppgifter.

GitHub Pages är dokumentationsyta och påverkar inte dashboardens autentiseringsmodell eller Cloudflare-produktionsdomän.
