# AGENTS.md

- Följ Avkrokens centrala tekniska kontext i `Avkroken/.github/docs/engineering-context.md`.
- Utgå från repositoryts aktuella default branch och arbeta i en separat arbetsgren med formatet `{agent}/{feature}/{YYYY-MM-DD}/{HH-mm}-{id}`.
- Öppna pull request mot default branch, för närvarande `main`.
- Håll ändringar strikt begränsade till den efterfrågade uppgiften.
- Kör `npm run check` innan en ändring betraktas som klar.
- Deploya inte och ändra inte Cloudflare-resurser utan uttrycklig begäran.
- Skvallerbyttans providerarkitektur är read-only. Begär, konfigurera eller använd inte provider-write-permissions för observationsfunktioner.
- Lägg aldrig in secrets, tokens, privata nycklar eller andra credentials i repot eller i publik GitHub Pages-dokumentation.
- Providerrawdata ska minimeras innan den exponeras. Returnera inte secret/token-värden, råa scanning-hemligheter, Worker secret bindings, KV values eller R2 object contents.
- Försvaga inte CI-, säkerhets- eller ruleset-krav för att få en ändring att passera.
- Capability keys, statusmodell, provenance och `/api/v1` är maskinkonsumerade kontrakt; breaking changes ska vara explicita och testskyddade.
- Repository-specifik aktuell teknisk kontext finns i `docs/project-context.md` och ska uppdateras när arkitektur eller driftstate förändras.
