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

## Canal oficial (Cloud API)

O WhatsApp por QR (WAHA) continua no compose. O canal oficial entra ao lado, quando a organização conectar um número. Esta seção só nomeia variáveis. Não há número, identificador de telefone, WABA nem token aqui — isso fica na sessão do canal ou no `.env` da VPS, e ligar o número precisa do `/def-ok` de quem administra.

A firma HMAC dos webhooks WAHA, acima, continua obrigatória: segredo vazio não sobe este compose.

## Variáveis do canal oficial

Nomes, sem valor:

- `META_APP_SECRET` — assinatura HMAC-SHA256 do webhook (`x-hub-signature-256`).
- `META_WEBHOOK_VERIFY_TOKEN` — o handshake GET. A Meta compara com o que está no app.
- `META_GRAPH_VERSION` — versão da Graph. O código assume `v22.0` se estiver vazio.
- `META_PHONE_NUMBER_ID` e `META_SYSTEM_USER_TOKEN` — fallback de instalação com um número só. Com credencial gravada na sessão (`channel_sessions`), o env deixa de valer para aquele envio.

O número em si não é variável deste arquivo. Ele entra depois, na sessão do canal da organização, ou nesses dois nomes de fallback. Esse passo não faz parte de subir o compose.

## País do telefone e marketing

Em `organizations.settings`, sem migração:

- `phone_default_country`: `BR` (padrão, ausência inclusive) ou `EC`. Com `EC`, um celular local `099…` vira E.164 do Equador. Com `BR`, a regra antiga não muda.
- `require_marketing_consent`: só `true` barra modelo de categoria MARKETING para contato sem `contacts.consent.marketing.granted_at`. UTILITY segue. O padrão é não exigir.
