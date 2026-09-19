# Skvallerbyttan

Skvallerbyttan är Avkrokens privata, strikt read-only observationslager, eventnav och operativa dashboard för GitHub och Cloudflare. Provider-events landar här, normaliseras till gemensam historik och kan därefter signalera andra Avkroken-tjänster utan att de behöver egna provider-webhooks. Samma normaliserade state används av dashboarden och av auktoriserade maskinklienter.

## Länkar

- **Tjänst:** https://skvallerbyttan.denied.se
- **Publik dokumentation:** https://avkroken.github.io/Skvallerbyttan/
- **Dokumentationskälla:** [docs/](docs/)
- **Säkerhetsrapportering:** [SECURITY.md](SECURITY.md)

## Huvudfunktioner

- fem toppvyer: **Översikt**, **GitHub**, **Cloudflare**, **Aktivitet** och **Insyn**
- GitHub App-baserad läsning av repository-, Actions-, security- och governance-state
- GitHub OAuth via Krösa-Maja för interaktiv användarinloggning
- read-only Cloudflare API för account, zones, Workers, Storage, Zero Trust, Notifications och Audit Logs
- central event-ingress för GitHub-, Cloudflare Notifications- och CASB-webhooks
- intern Cloudflare Service Binding till Avkroken-portalen för riktade följdsignaler, till exempel docs-cache invalidation
- normaliserad Activity-ledger med uttrycklig observationsgrad
- versionerat maskin-API under `/api/v1`
- capability-, permission-, freshness- och provider-health-modell
- read telemetry med consumer-attribution
- D1 för persistent state, cache, snapshots och detaljerad eventhistorik
- Workers Analytics Engine för högfrekvent read telemetry
- rate-limit/budget-observation för GitHub och Cloudflare

Skvallerbyttan administrerar inte GitHub eller Cloudflare. Ingen ny provider-write-permission används för observationslagret. `avkroken.denied.se` och `Avkroken/.github` är front/central organisationsyta; Skvallerbyttan är den centrala platsen för provider-events, Activity och samlad historik.

## Dokumentation

- [Arkitektur](docs/architecture.md)
- [API](docs/api.md)
- [Permissions](docs/permissions.md)
- [Säkerhet](docs/security.md)
- [Drift](docs/operations.md)
- [Projektkontext](docs/project-context.md)

## Utveckling

```bash
npm ci
npm run check
```

`npm run check` kör tester, TypeScript typecheck och `wrangler deploy --dry-run`. Produktionsdeployment eller Cloudflare-resursändringar ingår inte i vanlig repositoryverifiering.
