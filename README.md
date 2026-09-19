# Skvallerbyttan

Skvallerbyttan är Avkrokens privata operativa dashboard för GitHub- och Cloudflare-signaler kring repositoryhälsa, säkerhet, leverans och drift. Tjänsten körs som en Cloudflare Worker och använder GitHub Apps, GitHub OAuth, Cloudflares read-only API och D1 utan att göra dashboarden publik.

## Länkar

- **Tjänst:** https://skvallerbyttan.denied.se
- **Publik dokumentation:** https://avkroken.github.io/Skvallerbyttan/
- **Dokumentationskälla:** [docs/](docs/)
- **Säkerhetsrapportering:** [SECURITY.md](SECURITY.md)

## Teknik

- TypeScript
- Cloudflare Workers
- Cloudflare D1
- GitHub App för tjänstens GitHub API-åtkomst
- GitHub OAuth via Krösa-Maja för användarinloggning
- GitHub webhooks för cacheinvalidering och säkerhetshistorik
- Cloudflare Notifications- och CASB-webhooks för eventdriven Cloudflare-historik
- Read-only Cloudflare API för Notifications- och CASB-konfiguration

Arkitektur, autentisering, webhookflöde, drift och aktuell repositorykontext finns i [projektdokumentationen](docs/index.md).

## Utveckling

Installera låsta beroenden och kör hela verifieringen:

```bash
npm ci
npm run check
```

`npm run check` kör tester, TypeScript-kontroll och en Wrangler dry-run. Deployment och ändringar av Cloudflare-resurser görs inte som en del av vanlig repositoryverifiering.

## GitHub Pages

Den publika projektdokumentationen byggs från `docs/` med GitHub Pages. Själva dashboarden fortsätter att köras på `skvallerbyttan.denied.se`; Pages är endast dokumentationsyta.
