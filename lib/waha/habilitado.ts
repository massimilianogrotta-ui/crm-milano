/**
 * O WAHA está ligado nesta instalação?
 *
 * Só o valor EXATO `false` desliga. Ausente, vazio, `0`, `no`, `FALSE`, `off`
 * deixam ligado: um typo no `.env` não pode apagar o canal de quem ainda usa
 * WAHA. O padrão é ligado — quem não escreveu a variável continua exatamente
 * como hoje.
 *
 * Lê a string crua. `z.coerce.boolean()` trataria a string `"false"` como
 * verdadeira (qualquer string não vazia coage para `true`) e ligaria o
 * transporte na instalação que pediu para desligar.
 */
export function wahaHabilitado(fonte?: { WAHA_ENABLED?: string | undefined }): boolean {
  // Sem default `= process.env`: ProcessEnv não declara WAHA_ENABLED, e o
  // alvo só com propriedades opcionais é tipo fraco (TS2559). A leitura crua
  // continua sendo process.env quando ninguém passa o objeto parseado.
  const lido = fonte ?? process.env;
  return lido.WAHA_ENABLED !== "false";
}

/** Mensagem estável das rotas e do cliente. Sem segredo, sem endereço. */
export const MENSAGEM_WAHA_DESLIGADO =
  "O WhatsApp via WAHA está desligado nesta instalação (WAHA_ENABLED=false). Nenhum envio nem sessão foi tentado.";

/**
 * Falha fechada, antes de qualquer rede.
 *
 * O prefixo `waha_disabled:` é o que os testes e o `wahaFriendlyError` reconhecem.
 * A frase depois é o que a pessoa lê.
 */
export class WahaDesligadoError extends Error {
  constructor() {
    super(`waha_disabled: ${MENSAGEM_WAHA_DESLIGADO}`);
    this.name = "WahaDesligadoError";
  }
}

/** No-op quando o WAHA está ligado. Lança antes de `fetch` quando está desligado. */
export function recusarSeWahaDesligado(): void {
  if (!wahaHabilitado()) throw new WahaDesligadoError();
}
