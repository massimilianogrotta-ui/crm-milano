import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { motivoDoErro, sql } from "./psql-transporte";

/**
 * O AUDIT LOG É SÓ-INCLUSÃO NO BANCO QUE O CLIENTE TEM — migration 0243
 * (porta de upstream 0258 + 0525).
 *
 * Todo projeto Supabase nasce com um default ACL de TABELAS em `public` que dá
 * UPDATE, DELETE e TRUNCATE a anon, authenticated e service_role. O prelude do
 * `test:db` do fork reproduz o default ACL só para FUNÇÕES; por isso cada caso
 * aqui primeiro SIMULA o de tabela (`grant all …`) e só então aplica o bloco da
 * 0243, LIDO do `supabase/baseline.sql` pelo rótulo — o texto que o self-host
 * aplica, não uma cópia. Tudo numa transação desfeita.
 *
 * O controle (simulação sem o bloco) prova que a simulação reproduz o defeito:
 * sem ele, um `grant` que não pegasse deixaria os casos verdes por nada.
 */

const BASELINE = readFileSync(join(process.cwd(), "supabase", "baseline.sql"), "utf8");

const ROTULO =
  "-- ---- o audit log é só-inclusão para TODO papel que não seja o dono (migration 0243) ----";

function blocoDa0243(): string {
  const inicio = BASELINE.indexOf(ROTULO);
  if (inicio === -1) throw new Error("rótulo da 0243 não encontrado no baseline");
  if (BASELINE.indexOf(ROTULO, inicio + 1) !== -1) throw new Error("rótulo da 0243 repetido no baseline");
  const fim = BASELINE.indexOf("\n-- ---- ", inicio + ROTULO.length);
  return BASELINE.slice(inicio, fim === -1 ? undefined : fim);
}

const DEFAULT_ACL_DO_SUPABASE =
  "grant all on table public.api_audit_log to anon, authenticated, service_role;";

const MARCA = "SONDA|";
const LINHA = "02430000-0000-4000-8000-0000000000c1";

function sondasDesfeitas(corpo: string): string[] {
  return sql(`begin;\n${corpo}\nrollback;`)
    .split("\n")
    .filter((linha) => linha.startsWith(MARCA))
    .map((linha) => linha.slice(MARCA.length));
}

function erroDo(script: string): string | null {
  try {
    sql(script);
    return null;
  } catch (err) {
    return motivoDoErro(err);
  }
}

/** Privilégios EFETIVOS (inclui herdados) de `papel` em api_audit_log, dentre `privs`. */
function sondaPrivs(papel: string, privs: readonly string[]): string {
  return `
    select '${MARCA}' || coalesce(string_agg(p, ',' order by p), '')
      from unnest(array[${privs.map((p) => `'${p}'`).join(", ")}]) p
     where has_table_privilege('${papel}', 'public.api_audit_log', p);`;
}

const ADULTERA = ["DELETE", "TRUNCATE", "UPDATE"] as const;
const PAPEIS = ["anon", "authenticated", "service_role"] as const;

describe("migration 0243 — api_audit_log só-inclusão", () => {
  it("controle: SEM o bloco, a simulação do Supabase dá DELETE e service_role apaga a linha", () => {
    const [efetiva, apagadas] = sondasDesfeitas(`
      ${DEFAULT_ACL_DO_SUPABASE}
      ${sondaPrivs("service_role", ADULTERA)}
      insert into public.api_audit_log (id, action) values ('${LINHA}', 'inv.0243.controle');
      set local role service_role;
      with d as (delete from public.api_audit_log where id = '${LINHA}' returning 1)
      select '${MARCA}' || count(*) from d;
    `);
    expect(efetiva).toBe("DELETE,TRUNCATE,UPDATE");
    expect(apagadas, "a simulação não reproduz o Supabase").toBe("1");
  });

  it("COM o bloco, nenhum dos três papéis tem UPDATE/DELETE/TRUNCATE, e INSERT/SELECT ficam", () => {
    const linhas = sondasDesfeitas(`
      ${DEFAULT_ACL_DO_SUPABASE}
      ${blocoDa0243()}
      ${PAPEIS.map((p) => sondaPrivs(p, ADULTERA)).join("\n")}
      ${PAPEIS.map((p) => sondaPrivs(p, ["INSERT", "SELECT"])).join("\n")}
    `);
    expect(linhas.slice(0, 3)).toEqual(["", "", ""]);
    expect(linhas.slice(3)).toEqual(["INSERT,SELECT", "INSERT,SELECT", "INSERT,SELECT"]);
  });

  for (const [comando, dml] of [
    ["DELETE", `delete from public.api_audit_log where id = '${LINHA}'`],
    ["UPDATE", `update public.api_audit_log set action = 'adulterado' where id = '${LINHA}'`],
    ["TRUNCATE", "truncate public.api_audit_log"],
  ] as const) {
    it(`service_role recebe permission denied no ${comando}`, () => {
      const erro = erroDo(`
        begin;
        ${DEFAULT_ACL_DO_SUPABASE}
        ${blocoDa0243()}
        insert into public.api_audit_log (id, action) values ('${LINHA}', 'inv.0243.alvo');
        set local role service_role;
        ${dml};
        rollback;
      `);
      expect(erro, `service_role executou ${comando} sem erro`).not.toBeNull();
      expect(erro).toContain("permission denied for table api_audit_log");
    });
  }

  it("um papel do operador (receita antiga do self-host) também é curado, sem vazar para outra tabela", () => {
    const [adultera, grava, outraTabela] = sondasDesfeitas(`
      create role inv_0243_worker nologin;
      grant select, insert, update, delete on all tables in schema public to inv_0243_worker;
      grant truncate on table public.api_audit_log to inv_0243_worker;
      ${blocoDa0243()}
      ${sondaPrivs("inv_0243_worker", ADULTERA)}
      ${sondaPrivs("inv_0243_worker", ["INSERT", "SELECT"])}
      select '${MARCA}' || coalesce(string_agg(p, ',' order by p), '')
        from unnest(array['DELETE', 'UPDATE']) p
       where has_table_privilege('inv_0243_worker', 'public.crm_leads', p);
    `);
    expect(adultera).toBe("");
    expect(grava).toBe("INSERT,SELECT");
    expect(outraTabela, "o revoke vazou para outra tabela").toBe("DELETE,UPDATE");
  });

  it("o expurgo legítimo continua apagando quando chamado por service_role", () => {
    const [apagadas, sobrou] = sondasDesfeitas(`
      ${DEFAULT_ACL_DO_SUPABASE}
      ${blocoDa0243()}
      insert into public.api_audit_log (id, action, created_at)
        values ('${LINHA}', 'inv.0243.vencida', now() - interval '400 days');
      set local role service_role;
      select '${MARCA}' || public.fn_expurgar_auditoria_vencida(90, 10000);
      select '${MARCA}' || count(*) from public.api_audit_log where id = '${LINHA}';
    `);
    expect(Number(apagadas)).toBeGreaterThanOrEqual(1);
    expect(sobrou).toBe("0");
  });
});
