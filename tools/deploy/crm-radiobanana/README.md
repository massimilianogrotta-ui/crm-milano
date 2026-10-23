# Radio Banana — firma HMAC dei webhook WAHA

Il compose consegna **un solo** segreto ai due servizi, per interpolazione, senza
scriverne il valore in nessun file del repository:

- `waha` riceve `WHATSAPP_HOOK_HMAC_KEY`
- `app` riceve `WAHA_HMAC_SECRET`

L'app verifica l'header `X-Webhook-Hmac` con HMAC-SHA512 (`sha512=<hex>`).
`WAHA_WEBHOOK_REQUIRE_SIGNATURE` nasce `false`: gli eventi senza firma
continuano a entrare finché non si è visto, in produzione, che il WAHA firma.

Generare il segreto (sul posto, non in chat e non nel git):

```bash
openssl rand -hex 32
```

Incollarlo in `.env` come `WAHA_HMAC_SECRET`. Il segnaposto è in `.env.example`.
Senza quel valore il compose si rifiuta di partire (`set WAHA_HMAC_SECRET in .env`).

## Ordine di messa in produzione

Non applicare questo compose a una stack spenta. La sequenza è questa.

### a) Redis/SRH e WAHA già sani

Sulla stack che gira adesso, prima di cambiare file:

```bash
docker compose --env-file .env ps
```

`srh` e `waha` devono essere up. Se il WAHA non è sano, sistemarlo prima: il
passo successivo ricrea il contenitore.

### b) Deploy della main con il segreto sui due servizi

1. Mettere `WAHA_HMAC_SECRET` nel `.env` (output di `openssl rand -hex 32`).
2. Lasciare `WAHA_WEBHOOK_REQUIRE_SIGNATURE` assente oppure `false`.
3. Aggiornare il checkout alla main che contiene questo compose e ricreare
   i due servizi che leggono il segreto:

```bash
docker compose --env-file .env up -d waha app
```

Ricreare `waha` riavvia il contenitore. Controllare che la sessione torni
operativa prima di andare avanti. Non stampare il `.env` e non lanciare
`docker exec … env`.

### c) Verificare che il WAHA firmi

Dopo un evento reale (un messaggio in entrata), la riga in
`webhook_events_log` deve avere `valid_signature = true`. Selezionare solo
quel flag, il tipo e l'orario — non `signature_header`, non `raw_body`, non
il segreto:

```sql
select valid_signature, event_type, created_at
from webhook_events_log
where provider = 'waha'
order by created_at desc
limit 5;
```

`true` vuol dire che l'header c'era e combaciava. `false` vuol dire che
l'evento è entrato senza firma (atteso finché il passo d non è stato fatto,
e segnale di fermarsi se il passo b è già in produzione da un evento reale).
Una firma presente ma sbagliata non arriva in questa tabella: la rotta
risponde 401 e lascia `webhook.hmac_invalid` nell'audit.

### d) Solo allora esigere la firma

Nel `.env`:

```bash
WAHA_WEBHOOK_REQUIRE_SIGNATURE=true
```

Ricreare **solo** l'app, così il WAHA non riparte un'altra volta:

```bash
docker compose --env-file .env up -d app
```

### e) Un POST senza firma viene rifiutato

Dalla macchina, sulla porta di loopback dell'app (`127.0.0.1`, non il
dominio pubblico: il dominio passa dal Caddy e la rotta globale risponde
404 prima del controllo HMAC). `SESSION` è un `waha_session_name` che
esiste già; una sessione sconosciuta risponde 200 `session_not_registered`
e non arriva alla firma. Il comando non porta segreto né header di firma:

```bash
curl -sS -D - \
  -X POST "http://127.0.0.1:${APP_PORT:-3101}/api/v1/webhooks/waha" \
  -H 'Content-Type: application/json' \
  --data '{"event":"session.status","session":"SESSION","payload":{"id":"unsigned-probe"}}'
```

Atteso: HTTP 401 e `"message":"signature_required"`.
