# Telegram Bridge — campanello "nuevo prospect" (GRATIS)

Minuscolo endpoint Node (zero dipendenze) che riceve il JSON dell'automazione
`call_webhook` del CRM (`lead.created`) e manda la notifica **Telegram** a Max.

```
CRM (automation_rules: lead.created → call_webhook)
   │  POST JSON {event, occurred_at, data:{lead, contact}}
   ▼
telegram-bridge.js (:8799, endpoint pubblico sul VPS)
   │  POST JSON chat_id/text
   ▼
api.telegram.org → Telegram di Max
```

Perché il bridge: il CRM deve chiamare un endpoint con un envelope proprio;
Telegram vuole un formato suo — il bridge fa da traduttore (e tiene il bot
token fuori dal DB del CRM).

## Setup del bot (5 minuti, una volta sola)

1. Telegram → parla con **@BotFather** → `/newbot` → scegli nome (es. All-io Prospects) → ricevi il **bot token** (formato `123456789:ABCdef...`).
2. Apri la chat col nuovo bot e mandagli un messaggio qualsiasi (serve per sbloccare la conversazione).
3. Prendi il tuo **chat ID**: apri nel browser `https://api.telegram.org/bot<TOKEN>/getUpdates` → nel JSON cerca `"chat":{"id":123456789}` (il tuo id personale).

## Installazione sul VPS (istanza crm.all-io.com)

1. Copia `tools/telegram-bridge/telegram-bridge.js` sul VPS (es. `/opt/crm-allio/telegram-bridge/`).
2. Crea lì un file `.env` **chmod 600** (mai in chat, mai nel repo):
   ```
   TELEGRAM_BOT_TOKEN=<bot token di @BotFather>
   TELEGRAM_CHAT_ID=<tuo chat id>
   PORT=8799
   ```
3. Avvia e tienilo vivo:
   ```
   set -a; source .env; set +a
   nohup node telegram-bridge.js > bridge.log 2>&1 &
   ```
   (oppure unit systemd Restart=always — stesso schema degli altri servizi VPS)
4. Regola nel DB dell'istanza All-io (psql, heredoc):
   ```sql
   insert into automation_rules (organization_id, name, trigger_event, conditions, actions, is_active)
   values ('<org_id>', 'Notifica nuevo prospect', 'lead.created', '[]'::jsonb,
   '[{"type":"call_webhook","config":{"url":"https://crm.all-io.com:8799/notifica"}}]'::jsonb, true);
   ```
   HTTPS: mettere il bridge dietro Caddy (reverse proxy) — il guard SSRF del CRM
   accetta solo host pubblici, e il bot token sta nel bridge, non nel CRM.

## Test end-to-end
1. Avvia il bridge con le env → log `in ascolto`.
2. POST di prova al webhook intake (o curl diretto al bridge col payload CRM).
3. Bridge log `telegram: 200` + messaggio che arriva sul telefono.
   (Locale 2026-09-12: protocollo verificato — con token fittizio Telegram
   risponde 401 "Unauthorized", prova che il formato della chiamata è giusto.)

## Nota messaggio
La notifica contiene solo: nome contatto, settore/vende/WhatsApp (campi già
pubblici del widget) e fonte — la proiezione pubblica del CRM (LEAD_PUBLIC_FIELDS)
esclude per costruzione i dati sensibili (custom_fields LGPD, cpf, ecc.).