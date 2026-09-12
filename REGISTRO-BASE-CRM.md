# REGISTRO — Base CRM riutilizzabile (crm-milano)

Documento che cataloga **dove sta la base**, **com'è** e **quali clienti ne derivano**,
così che si sappia sempre dov'è tutto senza doverlo chiedere.

> Aggiorna questo file ogni volta che crei un fork per un cliente nuovo.

---

## 1. Dove sta la base

| Dato | Valore |
|---|---|
| Cartella locale | `~/Dev/clients/crm-milano` |
| Repository | `https://github.com/massimilianogrotta-ui/crm-milano` |
| Origine progetto | Fork di **DeskcommCRM** (base CRM open-source) |
| Ramo di lavoro attuale | `main` (verificare con `git branch --show-current`) |
| Stato | In sviluppo — base comune da personalizzare per cliente |

## 2. Cos'è

CRM completo (deskcomm) preso come **seme comune** per i CRM da consegnare ai clienti.
Non è un prodotto finito: è la **base condivisa** da cui parte la personalizzazione
(branding, colori/font, lingue, dati seed specifici del cliente).

## 3. Localizzazione (i18n)

| Campo | Stato |
|---|---|
| Dict sorgente | `lib/i18n/dicionario.ts` (lingua base = spagnolo `es`) |
| Lingue | `es` (base), `it`, `en` |
| Voci | **5.309** — tutte con `it:` ed `en:` (completate 2026-09-12 via GLM) |
| Dati seed/DB | **DB invariato**; localizzazione dei dati PT solo in *display* (opzione 2) — nessuna modifica al database |

Backup dizionario prima/ripristino: `lib/i18n/dicionario.ts.bak-*` (vedi git).

## 4. Clienti derivati

*(Inizia a elencarli qui — es. `## Milano — Dentisti`, `## Milano — Estetica`.)*

Ogni derivato dovrebbe avere:
- cartella/scoping suo proprio (`~/Dev/clients/<cliente>-crm` oppure un ramo dedicato);
- fork GitHub privato `massimilianogrotta-ui/<cliente>-crm`;
- nota in questo registro con: cliente, segmento, fork URL, ramo, stato.

## 5. Convenzione di collocazione (ricorda)

- **Codice/config/dati → fuori da Google Drive** (restano in `~/Dev/clients/...` e GitHub).
- **Google Drive** = solo asset commerciali APPROVATO/DRAFT (landing, proposte, deck), sotto `Brand → Mercato → Tipo`.
  Per il CRM non caricare su Drive né code né ledgers né draft.
- Credenziali di test → `~/Dev/clients/.credentials-crm-milano.md` (MAI in git, MAI in chat).
