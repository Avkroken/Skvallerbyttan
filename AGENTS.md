# Skvallerbyttan — AI Agent Guide

## GitHub-arbetsflöde

Arbete sker via tillfälliga arbetsgrenar och pull requests till `main`. `main` är integrationsgrenen; arbetsgrenar får använda repo- eller agentvalda namn som `claude/*`, `codex/*`, `feature/*`, `fix/*` eller motsvarande. De återanvändbara `work/feature`, `work/fix` och `work/chore` får fortfarande användas där sync-pool finns men är inte obligatoriska.

- Öppna en ready PR till `main` och aktivera auto-merge omedelbart, även medan CI eller review fortfarande pågår.
- Required CI-checkar och olösta review-trådar är merge-blockerare. Läs och utvärdera alltid alla review-kommentarer; relevanta problem åtgärdas i samma PR innan tråden markeras resolved.
- Efter varje ny commit ska både CI och review-status kontrolleras igen. När required CI är grönt och alla review-trådar är resolved ska den redan armerade auto-merge-funktionen eller merge-kön föra PR:n till `main`.
- Om auto-merge inte sker trots gröna checkar och lösta review-trådar, identifiera exakt vilken repository-regel eller blockerare som återstår. Direkt merge får endast användas på uttrycklig instruktion.
- Kringgå aldrig branch protection, rulesets, required checks, review resolution eller merge queue.

`.github/workflows/pr-watchdog.yml` bevakar alla lokala branches utom `main`, merge-köns `gh-readonly-queue/*` och uttryckligen konfigurerade permanenta undantag. En branch med unika commits som har saknat öppen PR i mer än 60 minuter får en ready PR till `main` och squash auto-merge armeras. Exakt samma HEAD öppnas inte på nytt om den redan har behandlats i en stängd PR. Watchdoggen avgör inte om arbetet är önskvärt eller mergebart; CI, review och merge-gates gör det.

`.github/workflows/sync-pool.yml` får endast återställa eller synka de uttryckligen konfigurerade återanvändbara `work/*`-slotsen och får aldrig resetta godtyckliga agent- eller arbetsgrenar.
