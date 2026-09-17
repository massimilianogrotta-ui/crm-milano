# Brief per l'esecutore (GLM 5.3 via Claude Code) · Agente outreach P0

Lavori nel worktree `~/Dev/worktrees/crm-milano-outreach-p0`, branch `feat/outreach-p0`. Resta SEMPRE in questa cartella.

## Cosa fare
Esegui i Task **2, 3, 4, 5, 6, 7, 8, 9, 10** del piano `docs/superpowers/plans/2026-09-17-crm-allio-outreach-p0.md`, **uno alla volta, in ordine**.

Il **Task 1 è già fatto** (migrazione 0238, baseline, MANIFEST, cascata LGPD, test RLS): non toccare `supabase/` né `tests/invariants/rls-isolation.test.ts`.

## Regole ferree
1. Prima di iniziare leggi `CLAUDE.md` e `AGENTS.md` del repo e il piano intero.
2. Un task = un commit, con il messaggio indicato nel piano. Segui i passi TDD: test che fallisce → codice → test che passa.
3. **Dopo ogni commit FERMATI.** Scrivi: `TASK N FATTO · commit <hash> · test: <comando e esito>` e aspetta che l'utente scriva `continua`. Non iniziare il task successivo da solo.
4. **Mai** `git push`, `git merge`, `git rebase`, `git reset --hard`, deploy, o comandi verso produzione. Mai chiavi o dati veri: solo dati finti `@example.com`.
5. Non modificare file fuori da quelli elencati nel task. Non disattivare, saltare o indebolire test esistenti per farli passare.
6. Se un test esistente fallisce per causa tua e non capisci perché dopo 2 tentativi diversi: FERMATI e riporta il messaggio d'errore esatto.
7. Il codice del piano è la base: se un nome reale differisce (import, funzione, tipo), usa quello reale e segnalalo nel messaggio di fine task.
8. `lib/outreach/` non deve importare SDK di modelli né `@/lib/email/resend`; `lib/agent-engine/` e `lib/ai/` non devono importare `@/lib/outreach`.
9. `OUTREACH_DRY_RUN` resta vuoto ovunque. Nessuna email vera, mai.
10. Task 10 Step 2 (prova locale con stack avviato): se lo stack Supabase locale non parte, salta la prova, scrivilo nel report e fermati.

## Comandi utili
- Un test: `pnpm vitest run tests/unit/<file>.test.ts`
- Tipi: `pnpm typecheck` · Lint: `pnpm lint`
- Suite unit: `pnpm test:unit`
- DB (lento, ~5 min, serve Docker): `pnpm test:db`
