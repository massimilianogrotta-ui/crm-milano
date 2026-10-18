/**
 * 0240 (upstream 0508) — platform admin `support_readonly` não escreve pelo PostgREST (#2000).
 *
 * A policy `orgs_write_platform_admin` usava `fn_is_platform_admin()`, que ignora
 * o scope do JWT (~:325-333). Um platform admin com `scope = 'support_readonly'`
 * alterava colunas de exibição e `settings` de organizations com o próprio JWT.
 *
 * O conserto troca as policies de ESCRITA para `fn_is_platform_admin_full()`
 * (idêntica à atual, mas exigindo `scope = 'full'`), mantendo a leitura
 * (FOR SELECT) com `fn_is_platform_admin()` — `support_readonly` segue lendo,
 * só não escreve.
 *
 * Invariante medido em Postgres REAL:
 *   · JWT `support_readonly` → 0 linhas alteradas em organizations;
 *   · JWT `full` → continua escrevendo (controle positivo);
 *   · `support_readonly` continua LENDO a organização (a leitura não foi tocada).
 *
 * Previsão escrita antes de rodar (sabotagem): se o fix for revertido e as
 * policies voltarem a usar `fn_is_platform_admin()`, o caso "support_readonly"
 * devolve 1 em vez de 0 (o bug reabre) — os casos "0" ficam vermelhos.
 */
import { beforeAll, describe, expect, it } from "vitest";

import { GOV_CONTACT_1, GOV_ORG, countAs, seedGov, sql, writeCountAs } from "./gov-helpers";

const ORG = "cccccccc-2000-4000-8000-000000000001";
/** Platform admin `full` — o controle positivo que CONTINUA escrevendo. */
const FULL = "cccccccc-2000-4000-8000-000000000100";
/** Platform admin `support_readonly` — o caso que deve ficar em 0. */
const READONLY = "cccccccc-2000-4000-8000-000000000101";

beforeAll(() => {
  seedGov();
  sql(`
    delete from public.organizations where id = '${ORG}';
    insert into public.organizations (id, slug, legal_name, display_name)
      values ('${ORG}', 'org-0240', 'Org 0240', 'Org 0240');
    insert into auth.users (id, email) values
      ('${FULL}', 'full-0240@invariant.test'),
      ('${READONLY}', 'readonly-0240@invariant.test')
    on conflict (id) do nothing;
    delete from public.platform_admins where user_id in ('${FULL}', '${READONLY}');
    insert into public.platform_admins (user_id, granted_by, scope, mfa_required, reason) values
      ('${FULL}', '${FULL}', 'full', false, 'invariante 0240'),
      ('${READONLY}', '${FULL}', 'support_readonly', false, 'invariante 0240');
  `);
});

describe("0240 — support_readonly não escreve em organizations pelo PostgREST", () => {
  it("support_readonly altera 0 linhas de display_name", () => {
    expect(
      writeCountAs(
        READONLY,
        `update public.organizations set display_name = 'hackeado-readonly' where id = '${ORG}'`,
      ),
    ).toBe(0);
  });

  it("support_readonly altera 0 linhas de settings", () => {
    expect(
      writeCountAs(
        READONLY,
        `update public.organizations set settings = '{"data": "hackeado"}'::jsonb where id = '${ORG}'`,
      ),
    ).toBe(0);
  });

  it("CONTROLE POSITIVO: o platform admin full continua escrevendo display_name", () => {
    expect(
      writeCountAs(
        FULL,
        `update public.organizations set display_name = 'escrito-pelo-full' where id = '${ORG}'`,
      ),
    ).toBe(1);
  });

  it("CONTROLE POSITIVO: o platform admin full continua escrevendo settings", () => {
    expect(
      writeCountAs(
        FULL,
        `update public.organizations set settings = '{"data": "escrito pelo full"}'::jsonb where id = '${ORG}'`,
      ),
    ).toBe(1);
  });

  it("support_readonly continua LENDO a organização (a leitura não foi tocada)", () => {
    expect(countAs(READONLY, `select count(*) from public.organizations where id = '${ORG}';`)).toBe(1);
  });

  it("CONTROLE POSITIVO: o full também lê a organização", () => {
    expect(countAs(FULL, `select count(*) from public.organizations where id = '${ORG}';`)).toBe(1);
  });
});
describe("0240 — support_readonly não escreve em contacts de outra organização (fork)", () => {
  // No fork `fn_support_write_allowed()` (0220) devolve true SEM sessão de
  // suporte, então a única barreira para o admin só-leitura fora de sessão é a
  // policy de escrita com `_full`.
  it("support_readonly altera 0 contatos da org alheia", () => {
    expect(
      writeCountAs(
        READONLY,
        `update public.contacts set display_name = 'hackeado-readonly' where id = '${GOV_CONTACT_1}' and organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(0);
  });

  it("support_readonly continua LENDO o contato", () => {
    expect(countAs(READONLY, `select count(*) from public.contacts where id = '${GOV_CONTACT_1}';`)).toBe(1);
  });

  it("CONTROLE POSITIVO: o full continua escrevendo no contato", () => {
    expect(
      writeCountAs(
        FULL,
        `update public.contacts set display_name = 'escrito-pelo-full' where id = '${GOV_CONTACT_1}' and organization_id = '${GOV_ORG}'`,
      ),
    ).toBe(1);
  });
});
