/**
 * 0241 — NOTA INTERNA: EDITAR E APAGAR SÓ O AUTOR OU MANAGER+ (porta adaptada de
 * upstream d9c3afdfc, lá 0505/0509, #1870).
 *
 * Antes da 0241 a escrita era uma policy única `for all` (0063) com org + papel
 * `agent`, sem distinguir o AUTOR: qualquer agent da organização editava ou
 * apagava, pelo PostgREST com o próprio JWT, a nota de um colega sem passar pela
 * rota (que já exigia autor ou manager+).
 *
 * No fork a leitura das notas é org-wide (a 0478 do upstream não foi portada),
 * então os dois agentes leem a nota e a ÚNICA razão de GOV_AGENT_A não poder
 * editá-la é a autoria.
 *
 * Sabotagem: no baseline anterior à 0241 os casos "não edita / não apaga / não
 * cria em nome de outro" devolvem 1 em vez de 0.
 */
import { beforeAll, describe, expect, it } from "vitest";

import {
  GOV_AGENT_A,
  GOV_AGENT_B,
  GOV_CONV_UNASSIGNED,
  GOV_MANAGER,
  GOV_ORG,
  GOV_VIEWER,
  countAs,
  seedGov,
  sql,
  writeCountAs,
} from "./gov-helpers";

/** Nota autorada por GOV_AGENT_B numa conversa da organização. */
const NOTA_DE_B = "d0d0d0d0-0241-4000-8000-000000000001";
/** Sondas de UPDATE/DELETE; recriadas no seed para o controle contar a cada rodada. */
const SONDA_UPDATE = "d0d0d0d0-0241-4000-8000-000000000002";
const SONDA_DELETE = "d0d0d0d0-0241-4000-8000-000000000003";

beforeAll(() => {
  seedGov();
  sql(`
    delete from public.conversation_notes where id in ('${NOTA_DE_B}', '${SONDA_UPDATE}', '${SONDA_DELETE}');
    insert into public.conversation_notes
      (id, organization_id, conversation_id, body, created_by_user_id, created_by_name)
      values
        ('${NOTA_DE_B}', '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', 'nota do B na conversa livre', '${GOV_AGENT_B}', 'B'),
        ('${SONDA_UPDATE}', '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', 'sonda update', '${GOV_AGENT_B}', 'B'),
        ('${SONDA_DELETE}', '${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', 'sonda delete', '${GOV_AGENT_B}', 'B');
  `);
});

describe("0241 — edita e apaga nota só o autor ou manager+", () => {
  it("os dois agentes LEEM a nota (controle de cenário)", () => {
    const contar = `select count(*) from public.conversation_notes where id = '${NOTA_DE_B}';`;
    expect(countAs(GOV_AGENT_A, contar)).toBe(1);
    expect(countAs(GOV_AGENT_B, contar)).toBe(1);
  });

  it("o agent que NÃO é o autor NÃO edita a nota", () => {
    // sem a 0241 isto devolve 1 — era o buraco da #1870
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `update public.conversation_notes set body = 'hackeada' where id = '${NOTA_DE_B}'`,
      ),
    ).toBe(0);
  });

  it("o agent que NÃO é o autor NÃO apaga a nota", () => {
    expect(
      writeCountAs(GOV_AGENT_A, `delete from public.conversation_notes where id = '${NOTA_DE_B}'`),
    ).toBe(0);
  });

  it("o AUTOR edita a própria nota", () => {
    expect(
      writeCountAs(
        GOV_AGENT_B,
        `update public.conversation_notes set body = 'editada pelo autor' where id = '${SONDA_UPDATE}'`,
      ),
    ).toBe(1);
  });

  it("o AUTOR apaga a própria nota", () => {
    expect(
      writeCountAs(GOV_AGENT_B, `delete from public.conversation_notes where id = '${SONDA_DELETE}'`),
    ).toBe(1);
  });

  it("VIEWER (abaixo de agent) nunca escreve, mesmo sendo autor", () => {
    // viewer não passa no piso `agent` das policies novas
    expect(
      writeCountAs(
        GOV_VIEWER,
        `update public.conversation_notes set body = 'x' where id = '${NOTA_DE_B}'`,
      ),
    ).toBe(0);
  });

  it("MANAGER+ apaga nota de colega", () => {
    expect(
      writeCountAs(GOV_MANAGER, `delete from public.conversation_notes where id = '${NOTA_DE_B}'`),
    ).toBe(1);
  });

  it("ninguém CRIA nota em nome de outro (autor = a própria sessão)", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.conversation_notes (organization_id, conversation_id, body, created_by_user_id)
           values ('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', 'em nome do B', '${GOV_AGENT_B}')`,
      ),
    ).toBe(0);
  });

  it("CONTROLE POSITIVO: o agent cria a própria nota", () => {
    expect(
      writeCountAs(
        GOV_AGENT_A,
        `insert into public.conversation_notes (organization_id, conversation_id, body, created_by_user_id)
           values ('${GOV_ORG}', '${GOV_CONV_UNASSIGNED}', 'nota do A', '${GOV_AGENT_A}')`,
      ),
    ).toBe(1);
  });
});
