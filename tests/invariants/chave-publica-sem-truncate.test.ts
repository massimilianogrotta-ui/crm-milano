import { describe, expect, it } from "vitest";

import { sql } from "./psql-transporte";

/**
 * A CHAVE PÚBLICA NÃO TEM TRUNCATE onde nenhum consumidor precisa — migration
 * 0244 (porta de upstream 0537) e a revogação de `idempotency_keys` (0219), que
 * no baseline passa a morar ao lado dos grants (upstream f6fe03797).
 *
 * TRUNCATE não passa pela RLS: com ele, quem tem a chave `anon` (a que vai ao
 * browser) esvaziaria a tabela inteira. O corpo do baseline concede `GRANT ALL`
 * às duas tabelas; o que se mede aqui é o privilégio EFETIVO depois de
 * install + update, que é o banco que o cliente tem.
 *
 * Sabotagem: sem o revoke da 0244, `ai_budgets` devolve TRUNCATE para os dois
 * papéis.
 */
function truncatePara(tabela: string): string {
  return sql(`
    select coalesce(string_agg(p, ',' order by p), '')
      from unnest(array['anon', 'authenticated']) p
     where has_table_privilege(p, 'public.${tabela}', 'TRUNCATE');
  `);
}

describe("chave pública sem TRUNCATE", () => {
  it("controle: service_role ainda tem TRUNCATE em ai_budgets (a sonda enxerga o privilégio)", () => {
    expect(sql(`select has_table_privilege('service_role', 'public.ai_budgets', 'TRUNCATE');`)).toBe("t");
  });

  it("ai_budgets: anon e authenticated sem TRUNCATE (0244)", () => {
    expect(truncatePara("ai_budgets")).toBe("");
  });

  it("idempotency_keys: anon e authenticated sem TRUNCATE (0219, revoke ao lado dos grants)", () => {
    expect(truncatePara("idempotency_keys")).toBe("");
  });

  it("ai_budgets: SELECT da chave autenticada continua (a leitura é da policy)", () => {
    expect(sql(`select has_table_privilege('authenticated', 'public.ai_budgets', 'SELECT');`)).toBe("t");
  });
});
