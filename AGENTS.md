# Skvallerbyttan — AI Agent Guide

## GitHub-arbetsflöde

Arbete sker via pull requests till `main`. Använd repositoryts befintliga arbetsgrenar och rulesets; skapa inte egna grenar om repot har en sluten branch-pool.

- Aktivera auto-merge omedelbart efter att en PR skapats, även medan CI eller review fortfarande pågår.
- Required CI-checkar och olösta review-trådar är merge-blockerare.
- Läs och utvärdera alltid alla review-kommentarer. Om en kommentar identifierar ett relevant problem ska det åtgärdas i samma PR innan tråden markeras resolved.
- Efter varje ny commit ska både CI och review-status kontrolleras igen.
- En review-tråd får markeras resolved först när kommentaren har utvärderats och eventuell nödvändig fix är genomförd.
- När required CI är grönt och alla review-trådar är resolved ska den redan armerade auto-merge-funktionen eller merge-kön föra PR:n till `main`.
- Om auto-merge inte sker trots gröna checkar och lösta review-trådar, identifiera exakt vilken repository-regel eller blockerare som återstår.
- Direkt merge får endast användas på uttrycklig instruktion.
- Kringgå aldrig branch protection, rulesets, required checks eller merge queue.
