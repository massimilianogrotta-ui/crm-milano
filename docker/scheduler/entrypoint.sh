#!/bin/sh
# Entrypoint do deskcomm-scheduler: escreve o crontab e entrega o PID 1 ao crond.
#
# Por que gerar em runtime em vez de assar o arquivo na imagem: o INTERNAL_SECRET
# só existe no .env do cliente, e o busybox crond não expande variáveis dentro da
# linha do cron. Então a expansão acontece aqui, uma vez, no start.
#
# O que MUDOU em relação ao `command:` inline do compose: não há mais
# `apk add --no-cache curl tzdata` a cada start. curl e tzdata vêm na imagem. O
# cron do cliente deixa de depender de a VPS ter internet e de o mirror do Alpine
# estar de pé no momento de um restart — que é justamente o momento em que a
# máquina está se recuperando de alguma coisa.
set -eu

if [ -z "${INTERNAL_SECRET:-}" ]; then
  echo "scheduler: INTERNAL_SECRET vazio — os crons responderiam 401 em silêncio." >&2
  echo "scheduler: confira a chave no .env e suba de novo." >&2
  exit 1
fi

# Constante, não configuração: `app` é o nome do serviço na rede interna do
# compose, e o scheduler não fala com mais nada. A primeira versão disto lia um
# `SCHEDULER_APP_ORIGIN` que o compose nunca repassava e nenhum template
# documentava — controle decorativo, que é pior que controle nenhum: quem o
# encontrasse no código o definiria no `.env` e não veria efeito.
APP_ORIGIN="http://app:3000"

# minuto|timeout|caminho — uma linha por cron. O caminho vai COMPLETO de
# propósito: o literal `api/v1/cron/<rota>` é o contrato que
# tests/unit/cron-routes-scheduled.test.ts (e mais dois) leem por grep — esse
# teste compara a lista com o diretório app/api/v1/cron, e rota criada sem
# agendamento reprova o CI.
# A agenda do Google entra com DUAS cadências, e elas são diferentes de propósito.
#
# RENOVAÇÃO a cada 10 min: o access_token do Google expira em cerca de 1h, e a
# rodada só renova quem está a menos de 15 min do vencimento. Dez minutos deixa
# pelo menos uma tentativa de folga dentro da janela — a 15 min, um tick atrasado
# já deixaria o token vencer. É barata: só toca conexão perto de expirar, e
# rodada vazia não audita.
#
# SYNC a cada 15 min, e NÃO na mesma cadência. Os custos são diferentes: renovar
# é uma requisição por conexão que está vencendo; sincronizar é uma por
# calendário, sempre. Colar as duas obrigaria a escolher entre renovar raro
# demais (e a agenda morre) ou sincronizar caro demais (e gasta cota do cliente).
#
# ⚠️ E o comentário fica AQUI, fora da string: dentro de CRONS= ele não seria
# comentário, seria DADO — e crase em prosa dentro de aspas duplas o shell
# EXECUTA. Foi o que quebrou o entrypoint na primeira tentativa desta linha.
CRONS="
* * * * *|25|api/v1/cron/agent-dispatcher
* * * * *|25|api/v1/cron/followup-flow-worker
* * * * *|45|api/v1/cron/event-log-drain
* * * * *|25|api/v1/cron/routing-worker
* * * * *|25|api/v1/cron/recover-stuck-messages
*/5 * * * *|25|api/v1/cron/storage-redaction?limit=50
*/5 * * * *|25|api/v1/cron/snooze-watcher
*/5 * * * *|25|api/v1/cron/attendant-heartbeat
*/5 * * * *|60|api/v1/cron/webhook-log-retention
*/5 * * * *|45|api/v1/cron/channel-health
*/10 * * * *|60|api/v1/cron/contact-avatars
*/10 * * * *|60|api/v1/cron/agenda-google-refresh
*/15 * * * *|90|api/v1/cron/agenda-google-sync
# A IDA. Cadência mais curta que a volta de propósito: quem marcou pela tela
# espera ver o compromisso no celular dele em minutos, e a ida é barata (só
# manda o que mudou). A volta é cara — varre calendário inteiro — e por isso
# roda a cada 15.
*/5 * * * *|60|api/v1/cron/agenda-google-push
# O LEMBRETE. A cada 5 minutos porque a antecedência é escolhida pelo dono no
# tipo de agendamento; uma varredura mais lenta transformaria avisar 30 minutos
# antes em avisar entre 30 e 45 minutos antes. Barato: só olha compromisso
# confirmado, futuro e ainda não avisado.
*/5 * * * *|45|api/v1/cron/agenda-reminder
*/15 * * * *|60|api/v1/cron/risk-watcher
*/30 * * * *|60|api/v1/cron/contact-phones
17 * * * *|60|api/v1/cron/contact-proposals-watcher
0 12 * * *|60|api/v1/cron/lgpd-sla-watcher
30 3 * * *|120|api/v1/cron/kb-conversations-batch
15 4 * * *|60|api/v1/cron/sync-model-catalog
40 4 * * *|120|api/v1/cron/data-retention
# O OUTREACH (P0): um giro por dia (10 rascunhos, limite do playbook). O
# scheduler roda com TZ=UTC (compose de produção): 8:30 UTC = 10:30 no horário
# de verão italiano e 9:30 no de inverno, sempre dentro da janela 9-19. A rota
# recusa sozinha o giro fora da janela italiana, então um fuso que mude não vira
# email de madrugada: o pior caso é um giro que não faz nada.
30 8 * * *|60|api/v1/cron/outreach-proposals
"

# CRONTAB_PATH é ponto de injeção do teste (tests/shell/scheduler-entrypoint.test.sh).
# Sem ele este script só seria exercitável dentro de um contêiner — e o único
# artefato executável novo desta entrega ficaria sem gate nenhum, que foi
# exatamente o achado da revisão adversarial.
DESTINO="${CRONTAB_PATH:-/etc/crontabs/root}"

umask 077
# O segredo vai num ARQUIVO, nunca na linha do crontab. Cada linha vira o
# argumento de um `/bin/sh -c`, e argumento de processo aparece no `ps` do host
# para qualquer usuário local enquanto o job roda — e o curl vive até o `-m`.
# O curl lê o header com `-H @arquivo` (curl ≥ 7.55), o mesmo padrão do
# `.env.cron-drain` do kit. De brinde, o valor deixa de passar pelo sh do crond:
# `$`, crase e aspas no segredo não precisam mais de escape nenhum.
# CRON_AUTH_DIR é ponto de injeção do teste, como o CRONTAB_PATH abaixo.
AUTH_DIR="${CRON_AUTH_DIR:-/run/deskcomm-cron}"
AUTH_FILE="$AUTH_DIR/header"
mkdir -p "$AUTH_DIR"
chmod 700 "$AUTH_DIR"
# Com o umask 077 o arquivo nasce 600 desde o primeiro byte; o chmod cobre um
# arquivo que já existisse de um start anterior.
printf 'Authorization: Bearer %s\n' "$INTERNAL_SECRET" > "$AUTH_FILE"
chmod 600 "$AUTH_FILE"

: > "$DESTINO"
echo "$CRONS" | while IFS='|' read -r quando timeout rota; do
  [ -n "$rota" ] || continue
  # `>/dev/null` só no STDOUT: o corpo da resposta é grande e não interessa aqui.
  # O STDERR era o que a redireção antiga (`>/dev/null 2>&1`) engolia junto — e
  # foi ali que a issue #1109 ficou seis versões invisível: o `sync-model-catalog`
  # tomava 401 do scheduler todo dia, o `curl -f` saía diferente de zero e o
  # crontab descartava saída E erro, então o catálogo ficava vazio sem que
  # ninguém visse um sintoma. Agora o status continua no STDERR do `curl -fsS`
  # (é o `-S` que o imprime) e, quando o comando falha, a linha acrescenta uma
  # frase dizendo qual rota falhou e o que conferir — os dois no STDERR, que o
  # `crond -f` entrega ao `docker logs` do scheduler. Em rodada saudável não há
  # uma linha a mais: o `||` só dispara em falha.
  # % é proibido aqui (crontab de vixie trata como início de stdin) e `$`/crase
  # seriam reavaliados pelo sh do crond — nenhum dos dois aparece na mensagem.
  printf '%s curl -fsS -m%s -H '"'"'@%s'"'"' "%s/%s" >/dev/null || echo "deskcomm-cron: FALHOU %s — veja o erro do curl logo acima; se for 401 ou 403, o segredo que este scheduler manda não é o que o app enxerga: confira INTERNAL_SECRET/INTERNAL_CRON_SECRET no .env e rode docker compose up -d --force-recreate app scheduler" >&2\n' \
    "$quando" "$timeout" "$AUTH_FILE" "$APP_ORIGIN" "$rota" "$rota" >> "$DESTINO"
done

exec crond -f -l 2
