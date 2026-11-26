import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Remove um par de aspas (simples ou duplas) que envolva o valor inteiro —
 * mesma convenção que `hostgator-setup-kit/install.sh` grava no `.env` de
 * TODA instalação self-host (`NEXT_PUBLIC_APP_URL="https://${DOMAIN}"`).
 * Sem isto, um self-hoster que rode `pnpm test:unit` na própria VPS antes de
 * atualizar vê a suíte inteira falhar com "Variáveis de ambiente inválidas"
 * (a URL vira `"https://…"` — aspas incluídas — e falha a validação Zod de
 * `lib/env.ts`), mesmo com o arquivo de teste correto. O template de exemplo
 * (o convívio local, sem instalador) não usa aspas — por isso o bug nunca
 * apareceu em desenvolvimento, só em VPS instalada pelo kit.
 */
function stripQuotes(value: string): string {
  if (value.length >= 2) {
    const first = value[0];
    const last = value[value.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      return value.slice(1, -1);
    }
  }
  return value;
}

/**
 * Carrega SÓ o arquivo de teste commitado. Não lê o ambiente real da máquina:
 * um checkout de trabalho pode ter chave de envio e o interruptor de prova
 * desligado, e a suíte passaria a falar com o provedor de verdade.
 *
 * O nome do arquivo está neste array e em mais nenhum literal daqui. O teste
 * `outreach-no-send-guard` reprova qualquer outro.
 */
const FILE_ENV_DI_TEST = [".env.test"] as const;

export function loadTestEnvFiles(read: typeof readFileSync = readFileSync): string[] {
  const letti: string[] = [];
  for (const envFile of FILE_ENV_DI_TEST) {
    const path = resolve(process.cwd(), envFile);
    letti.push(path);
    try {
      const content = read(path, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const [key, ...rest] = trimmed.split("=");
        if (key && !process.env[key]) {
          process.env[key] = stripQuotes(rest.join("=").trim());
        }
      }
    } catch {
      // Arquivo ausente: a suíte segue com o que o processo já tem e com os
      // placeholders abaixo. Não é licença para ir buscar outro arquivo.
    }
  }
  // Depois do arquivo, e mesmo se o processo já chegou com a variável: a suíte
  // não envia e não aponta para uma org. O arquivo de teste pode trazer o
  // interruptor desligado de propósito, para provar que ele não vence.
  process.env.OUTREACH_DRY_RUN = "true";
  process.env.OUTREACH_ORG_ID = "";
  return letti;
}

loadTestEnvFiles();

/**
 * Placeholders para as vars que `lib/env.ts` exige na IMPORTAÇÃO.
 *
 * Sem isto, qualquer arquivo de teste que importe (mesmo transitivamente) um
 * módulo que toque `@/lib/env` **não carrega** onde não há ambiente — e o CI é
 * exatamente esse lugar. O sintoma é cruel: some o arquivo inteiro em vez de
 * falhar um teste, então a contagem cai e ninguém vê que a cobertura evaporou.
 * Foi o que aconteceu no PR #58: 4 arquivos com 0 testes rodados, e o número
 * verde de 1322 escondendo que 3 deles eram novos.
 *
 * É o mesmo remédio que `lib/env.ts` já aplica na fase de build da imagem
 * ("semeia placeholders pras vars que faltam e revalida"), aqui restrito ao
 * setup de teste — a lógica de produção não é tocada.
 *
 * `??=` de propósito: valor já presente no processo (ou no arquivo de teste)
 * vence. O host `.invalid` é reservado por RFC 2606: se algum teste tentar
 * usar isto como URL de verdade, a chamada falha alto em vez de bater em
 * algum lugar existente.
 *
 * RESEND_API_KEY não entra aqui. Quem precisa dela liga no próprio teste.
 */
const PLACEHOLDERS: Record<string, string> = {
  NEXT_PUBLIC_SUPABASE_URL: "https://test-placeholder.invalid",
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "test-placeholder-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "test-placeholder-service-role-key",
};
for (const [chave, valor] of Object.entries(PLACEHOLDERS)) {
  process.env[chave] ??= valor;
}

import "@testing-library/jest-dom/vitest";

// jsdom não implementa ResizeObserver; Radix (ex.: Switch) usa em layout effects.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}
