# Report · Agente outreach CRM All-io · P0

Data: 2026-09-17 · Branch: `feat/outreach-p0` (worktree `~/Dev/worktrees/crm-milano-outreach-p0`) · **Nessun push, nessun deploy.**

## Cosa esiste ora
- Tabella `outreach_proposals` (0238) con RLS a ruoli (lettura org, scrittura `agent`+), cascata LGPD (passo 7c) ed export LGPD.
- Interruttore `OUTREACH_DRY_RUN` (qualsiasi valore ≠ `"false"` = nessun invio) e `OUTREACH_ORG_ID` (vuoto = worker spento), scritti anche da `install.sh`.
- Modelli email fissi (dentista, estetica, generico; primo contatto e ricontatto), senza prezzi, con footer STOP.
- Regole di selezione: max 20 per giro, dedup 7 giorni, bloccati e senza email esclusi, un solo ricontatto dopo 7 giorni.
- Rotta cron `/api/v1/cron/outreach-proposals` (4 giri al giorno, solo 9-19 ora italiana), insert riga per riga (l'indice unico parziale non regge `upsert`).
- Esecuzione approva/rifiuta con trava contro doppio invio; in dry-run nessuna chiamata a Resend.
- Primo contatto approvato: lead da "Da contattare" a "In attesa" + timeline, **senza** evento `lead.stage_changed` (non riattiva automazioni).
- Pagina `/app/outreach` (Da approvare: approva, modifica, rifiuta; storico; avviso modalità prova) e voce nel menu CRM.
- Barriera: il motore IA non importa `lib/outreach`, `lib/outreach` non importa SDK di modelli né Resend.

## Commit
```
f9991128 fix(outreach): rounded-md nos campos de edição da fila (guarda Tailwind 4)
9fe688b9 test(outreach): barriera, il motore IA non raggiunge l'invio
c44e7f4b fix(outreach): valida a ação recebida do cliente antes de decidir
6938be4f feat(outreach): pagina Da approvare con approva, modifica e rifiuta
1b734873 feat(outreach): esecuzione approva/rifiuta con dry-run e trava contro doppio invio
22a4f4dc feat(outreach): sposta il lead a In attesa dopo il primo contatto approvato
e4589eb5 fix(outreach): export LGPD inclui outreach_proposals e install.sh grava as chaves OUTREACH_*
1ad280c2 feat(outreach): worker cron che prepara la coda Da approvare
1530041e feat(outreach): regole pure di selezione (cap 20, dedup 7gg, bloccati, ricontatto)
16f4124e feat(outreach): modelli email fissi per dentisti, estetica e generico
d0fe4320 feat(outreach): interruttore dry-run e org del worker
0c1a4237 feat(outreach): tabella outreach_proposals con RLS a ruoli, cascata LGPD e prova di isolamento (0238)
```
Fuori piano: `e4589eb5` (export LGPD + install.sh, richiesti dai test di invariante), `c44e7f4b` (validazione dell'azione ricevuta dal client), `f9991128` (classe CSS richiesta dalla guardia Tailwind 4).

## Verifiche (2026-09-17)
- `pnpm typecheck`: PASS.
- `pnpm test:db`: 188 file, 1515 test PASS.
- `pnpm test:unit`: 8372 PASS, 1 FAIL `health-separa-env-errado-de-servico-caido` per tempo (>2s sotto carico); rilanciato da solo: 3/3 PASS. Nessun file del branch lo tocca.
- `pnpm lint`: 1 errore in `app/global-error.tsx` (`useMemo(idiomaDoErro, [])`), file non toccato dal branch, quindi già presente su main. Lint sui file cambiati dal branch: pulito.
- `hostgator-setup-kit/test-validators.sh`: resta rosso solo "nome antigo com apóstrofo", dovuto al bash 3.2 di macOS (riportato dall'esecutore, non riverificato su Linux).

## Non fatto
- Acceptance spec: "bozza pending senza invio", "reject senza invio", "zero tool send all'LLM", "no voice, no blast" coperti dai test unitari. "Approve → dry-run + nota/stage" ora coperto anche end-to-end (vedi sotto).

## Prova locale end-to-end (Task 10 Step 2) — eseguita 2026-09-17

Ambiente: worktree `feat/outreach-p0`, Supabase locale `deskcomm-crm` (già in esecuzione, core containers up), `pnpm dev` (Next dev, porta 3010 — la 3000 era occupata da un altro servizio locale non correlato). `RESEND_API_KEY` finta, `OUTREACH_DRY_RUN` lasciata **vuota** (dry-run attivo per default).

**Scoperta prima di procedere:** l'org locale esistente `crm-milano-test` (`269c3125-…`) conteneva già 492 lead **reali** (studi/centri di Milano con email vere) nella pipeline `milano-prospect`, stage "Da contattare" — probabilmente importati per la campagna vera. Usare quell'org per la prova avrebbe mescolato le proposte finte con proposte generate sui lead veri (la selezione prende i primi 20 per `created_at` asc, quindi i lead veri, più vecchi, sarebbero entrati). Per rispettare "niente dati veri" ho creato un'organizzazione di test **isolata** (`outreach-p0-test`, id `b8391240-238b-440b-b44e-57d352cd36f7`) con una propria pipeline `milano-prospect` (stage `da-contattare`/`in-attesa`), 3 lead finti (Dentistico, Estetica, Bloccato) con contatti `@example.com`, e un utente di test (`outreach.p0.tester@example.com`, ruolo `agent`) solo su quest'org. La migrazione 0238 non era applicata nel db locale (tabella assente): applicata via `psql` direttamente dal file di migrazione (idempotente, già presente anche in `baseline.sql`), senza `db reset`.

| Atteso | Esito | Evidenza |
|---|---|---|
| Migrazione 0238 presente in locale | PASS (dopo applicazione manuale) | `to_regclass('public.outreach_proposals')` → `outreach_proposals` |
| Chiamata cron in orario notturno → `fuori_orario` | PASS | `curl` alle 02:23 CEST → `{"data":{"stato":"fuori_orario"}}` |
| `generaProposte` (bypass controllo orario) su 3 candidati → 2 proposte `pending`, bloccato escluso | PASS | script tsx: `{"stato":"ok","candidati":3,"create":2}`; righe in db: `first_contact.dentista.v1` e `first_contact.estetica.v1`, entrambe `status=pending`, `dry_run=t` |
| Seconda chiamata → 0 nuove (dedup) | PASS | script tsx: `{"stato":"ok","candidati":3,"create":0}` |
| UI `/app/outreach`: login utente test, coda visibile | PASS | screenshot `outreach-01-coda.png` |
| Approva prima proposta (Estetica) → stato dry-run "Teste", lead spostato a "In attesa", nota in timeline, nessun evento `lead.stage_changed`, nessuna email | PASS | db: `status=sent, dry_run=t, provider_message_id=NULL`; lead in stage `in-attesa`; `crm_lead_activities` con nota "Primo contatto email approvato (modalità prova...)"; `event_log` per l'org: 0 righe; log server senza occorrenze di "resend"/`api.resend.com`; screenshot `outreach-02-dopo-approva.png` |
| Rifiuta seconda proposta (Dentistico) → `rejected`, lead fermo | PASS | db: `status=rejected`; lead resta in stage `da-contattare`; screenshot `outreach-03-dopo-rifiuta.png` |

**Nota sul salto del controllo orario:** il Passo 3 previsto dal piano (chiamare il cron in orario 9-19 Italia) non era eseguibile alle ~02:20 locali del giorno della prova; la chiamata HTTP al cron ha comunque confermato il comportamento corretto (`fuori_orario`, nessuna generazione). Per provare la logica di generazione/selezione ho invocato `generaProposte(createAdminClient(), orgId)` direttamente da uno script tsx temporaneo (fuori dalla rotta HTTP, quindi il controllo orario del cron non è mai stato bypassato "nel codice": è stato bypassato chiamando la funzione un livello sotto la rotta, che è dove il piano stesso indicava di intervenire). La rotta cron in sé, con il suo controllo orario, non è stata modificata né disattivata.

Bug incontrati: nessuno. Nessuna modifica al codice del branch. Screenshot e log conservati nello scratchpad della sessione (non nel repo). Dati di test rimasti nel db locale `deskcomm-crm` (org `outreach-p0-test`, pipeline, lead, contatti, utente) — sono dati finti isolati, non toccano l'org reale; rimovibili su richiesta.

## Prima degli invii veri (decide Max)
1. Rivedere i testi dei modelli (`lib/outreach/templates.ts`).
2. Dominio `all-io.com` verificato su Resend in produzione; `RESEND_FROM_EMAIL` = indirizzo di Max.
3. Controllare che l'org All-io non abbia automazioni su nuove note della pipeline Milano.
4. Le risposte "STOP" arrivano nella casella di Max: bloccare a mano il contatto nel CRM.
5. Deploy con `OUTREACH_DRY_RUN` vuoto, un giro di prova, poi `false` solo con ok di Max.
