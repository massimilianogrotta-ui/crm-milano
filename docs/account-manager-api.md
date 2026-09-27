# API Account manager — CRM All-io

API riservata all'agente IA «Account manager». Legge contatti e trattative, scrive
poco e solo ciò che serve. **Non** cancella, **non** importa/esporta in blocco,
**non** invia email o messaggi.

## Accesso

- **URL base:** `https://srv1711723.tail466c27.ts.net:8443/api/v1/account-manager`
  — raggiungibile **solo dalla rete Tailscale**. Da `crm.all-io.com` le stesse
  rotte rispondono 404.
- **Autenticazione:** `Authorization: Bearer dsk_…` — token dedicato all'agente,
  con scope `am:read` e `am:write`. Un token del CRM senza questi scope riceve 403.
- **Revoca:** `update api_tokens set revoked_at = now() where prefix = 'dsk_…'`
  (oppure la rotta admin `POST /api/v1/settings/api-tokens/{id}/revoke`). Effetto immediato.
- **Limite:** 120 chiamate al minuto per token (poi 429).
- **Registro:** ogni chiamata finisce in `api_audit_log` con
  `action = 'account_manager.api_call'`, ora, id del token, metodo, percorso, esito.

```bash
export AM_BASE="https://srv1711723.tail466c27.ts.net:8443/api/v1/account-manager"
export AM_TOKEN="dsk_…"   # dal file consegnato, mai in chat
```

Risposte: successo `{"data": …, "meta"?: …}`; errore `{"error": {"code", "message", "details"?}}`.
Codici: 401 token assente/revocato/scaduto · 403 scope mancante · 404 non trovato
(o fuori dalla propria azienda) · 409 contatto già esistente · 422 dati non validi · 429 troppe chiamate.

## Lettura (`am:read`)

### Cercare contatti
`GET /contacts` — filtri tutti facoltativi, combinabili:

| Parametro | Significato |
|---|---|
| `nome` | parte del nome |
| `azienda` | parte del nome azienda (campo azienda del contatto o titolo di una sua trattativa) |
| `tag` | tag esatto |
| `ultimo_contatto_dal`, `ultimo_contatto_al` | data `YYYY-MM-DD` sull'ultimo contatto |
| `limit` (1-100, default 50), `offset` | paginazione; `meta.totale` dà il totale |

```bash
curl -s -H "Authorization: Bearer $AM_TOKEN" \
  "$AM_BASE/contacts?azienda=frutta&ultimo_contatto_dal=2026-09-01&limit=20"
```

### Dettaglio contatto
`GET /contacts/{id}` — contatto, trattative, storico attività (ultime 100), note, bozze di follow-up.

```bash
curl -s -H "Authorization: Bearer $AM_TOKEN" "$AM_BASE/contacts/<contact_id>"
```

### Trattative
`GET /leads` — ognuna con `stato` (open/won/lost), `fase`, `valore`, `valuta`,
`prossimo_passo`, `prossimo_passo_entro`, `ultimo_movimento`.
Filtri: `stato`, `contact_id`, `pipeline_id`, `stage_id`, `mossi_dal` (`YYYY-MM-DD`), `limit`, `offset`.

```bash
curl -s -H "Authorization: Bearer $AM_TOKEN" "$AM_BASE/leads?stato=open&mossi_dal=2026-09-01"
```

### Fasi
`GET /stages` — le fasi valide (id, nome, pipeline) da usare per spostare una trattativa.

## Scrittura (`am:write`)

### Aggiornare stato e prossimo passo di una trattativa
`PATCH /leads/{id}` — tutti i campi facoltativi, almeno uno:

| Campo | Significato |
|---|---|
| `stage_id` | nuova fase (stessa pipeline) |
| `esito` | `won` o `lost` (non insieme a `stage_id`) |
| `motivo` | obbligatorio con `lost`: codice (`price`, `no_response`, `requested_by_customer`, `product_unavailable`, `cancelled_by_customer`, `other`) o testo libero (salvato come `other` + testo nello storico) |
| `prossimo_passo` | testo, `null` per cancellarlo |
| `prossimo_passo_entro` | data `YYYY-MM-DD` o `null` |

```bash
curl -s -X PATCH -H "Authorization: Bearer $AM_TOKEN" -H "Content-Type: application/json" \
  -d '{"stage_id":"<stage_id>","prossimo_passo":"Demo giovedì","prossimo_passo_entro":"2026-10-02"}' \
  "$AM_BASE/leads/<lead_id>"
```

### Aggiungere una nota o un'attività
`POST /contacts/{id}/notes`
- nota: `{"testo": "...", "titolo"?: "..."}`
- attività sulla timeline di una trattativa del contatto: `{"tipo": "attivita", "testo": "...", "lead_id": "..."}`

```bash
curl -s -H "Authorization: Bearer $AM_TOKEN" -H "Content-Type: application/json" \
  -d '{"titolo":"Chiamata","testo":"Interessato, richiamare dopo la fiera"}' \
  "$AM_BASE/contacts/<contact_id>/notes"
```

### Creare un contatto (uno alla volta)
`POST /contacts` — `{"nome", "azienda"?, "email"?, "telefono"? (E.164, es. +393331234567), "tag"?: []}`.
Crea solo l'anagrafica: nessun canale aperto, nessun messaggio.

```bash
curl -s -H "Authorization: Bearer $AM_TOKEN" -H "Content-Type: application/json" \
  -d '{"nome":"Giulia Verdi","azienda":"Verdi Export","email":"giulia@example.com"}' \
  "$AM_BASE/contacts"
```

### Salvare una bozza di follow-up
`POST /contacts/{id}/followup-drafts` — `{"testo", "oggetto"?, "canale"?: "email"|"whatsapp"|"altro", "lead_id"?}`.
**Solo bozza:** resta nel CRM, visibile nel dettaglio contatto. Nessun invio.

```bash
curl -s -H "Authorization: Bearer $AM_TOKEN" -H "Content-Type: application/json" \
  -d '{"oggetto":"Demo di giovedì","testo":"Buongiorno, le confermo la demo di giovedì alle 10."}' \
  "$AM_BASE/contacts/<contact_id>/followup-drafts"
```

## Cosa non c'è, di proposito
Cancellazioni, modifiche in blocco, import/export, invio di email/WhatsApp,
accesso a conversazioni e messaggi. Nessuna rotta DELETE/PUT (test `lib/account-manager/guard.test.ts`).

## Nota per chi gestisce il CRM
Spostare una trattativa o crearla genera gli eventi normali del CRM
(`lead.stage_changed`, …). Se un giorno si attiva una regola di automazione che
invia messaggi su quegli eventi, anche le mosse dell'agente la farebbero scattare.
Al 2026-09-27 l'organizzazione All-io non ha regole di automazione.
