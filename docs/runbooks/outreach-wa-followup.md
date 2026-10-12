# Outreach WhatsApp: accensione controllata

Stato: canale spento per default; il codice di proposta e approvazione è già presente.

1. In un ambiente locale fresco, applicare il baseline e avviare la suite E2E con
   `OUTREACH_DRY_RUN=true`. La spec `tests/e2e/outreach-wa-approval.spec.ts`
   crea due organizzazioni fittizie, verifica la coda WhatsApp e l'approvazione
   senza invio reale. Conservare le schermate in `.superpowers/evidence/outreach-wa/`.
2. Per generare anche bozze di ricontatto WhatsApp, configurare
   `OUTREACH_WA_FOLLOWUP=true` e `OUTREACH_WA_FOLLOWUP_GIORNI=10` (o il numero
   di giorni approvato da Max). Impostare `OUTREACH_ORG_ID` sulla sola org
   autorizzata. Tenere `OUTREACH_DRY_RUN=true`: l'approvazione produce una nota
   sul lead e uno stato di test, senza chiamare il trasporto.
3. Controllare nella coda **Da approvare** il badge WhatsApp, il destinatario,
   il testo e la nota dopo l'approvazione. Le proposte `pending` non inviano da
   sole. Non portare `OUTREACH_DRY_RUN` a `false` senza decisione di Max.

Il cron crea proposte soltanto tra le **09:00 e le 19:00, ora di Roma**. Il
limite di **10 invii veri per giorno di Roma** e il lock Redis per organizzazione
proteggono l'approvazione quando il dry-run è disattivato. Anche l'approvazione
di un follow-up WhatsApp ricontrolla la fascia 09:00–19:00: fuori orario la
bozza resta `pending` e l'azione restituisce `fuori_orario`. In assenza di Redis
valido l'azione reale fallisce chiusa.

Nessun passo di questo runbook autorizza deploy, accesso VPS o invio reale.
