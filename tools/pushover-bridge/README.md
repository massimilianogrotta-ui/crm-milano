# Pushover Bridge — campanello "nuovo prospect"

Minuscolo endpoint Node (zero dipendenze) che riceve il JSON dell'automazione
`call_webhook` del CRM (`lead.created`) e manda la notifica **Pushover** a Max.

```
CRM (automation_rules: lead.created → call_webhook)
   │  POST JSON {event, occurred_at, data:{lead, contact}}
   ▼
pushover-bridge.js (:8799, endpoint pubblico sul VPS)
   │  POST form-urlencoded token/user/title/message
   ▼
api.pushover.net → telefono Max
```

Perché il bridge: Pushover accetta solo form-urlencoded, il CRM invia solo JSON.

## Installazione sul VPS (istanza crm.all-io.com)

1. Copia la cartella `tools/pushover-bridge/` sul VPS (es. `/opt/crm-allio/pushover-bridge/`).
2. Crea lì un file `.env` **chmod 600** (mai in chat, mai nel repo):
   ```
   PUSHOVER_TOKEN=<application token Pushover di Max>
   PUSHOVER_USER=<user key di Max>
   PORT=8799
   ```
   Token Pushover: https://pushover.net → applica una "Application" → ricevi il token.
3. Avvia e tienilo vivo (systemd consigliato):
   ```
   set -a; source .env; set +a
   nohup node pushover-bridge.js > bridge.log 2>&1 &
   ```
   (oppure unit systemd/Restart=always — stesso schema degli altri servizi VPS)
4. Regola nel DB dell'istanza All-io (psql, heredoc):
   ```sql
   insert into automation_rules (organization_id, name, trigger_event, conditions, actions, is_active)
   values ('<org_id>', 'Notifica nuovo prospect', 'lead.created', '[]'::jsonb,
   '[{"type":"call_webhook","config":{"url":"https://crm.all-io.com:8799/notifica"}}]'::jsonb, true);
   ```
   HTTPS: mettere il bridge dietro Caddy (reverse proxy) oppure aprire la porta con TLS;
   il guard SSRF del CRM accetta solo host pubblici.

## Test end-to-end (fatto in locale 2026-09-12)
1. Avvia il bridge con le env → log `in ascolto`.
2. POST di prova al webhook intake → il CRM crea il lead e chiama il bridge.
3. `automation_rule_runs` → status `success`; Pushover su telefono → notifica ricevuta.

## Nota messaggio
La notifica contiene solo: nome contatto, settore/vende/WhatsApp (campi già
pubblici del widget) e fonte — il proiettore pubblico del CRM (LEAD_PUBLIC_FIELDS)
esclude per costruzione i dati sensibili (custom_fields LGPD, cpf, ecc.).