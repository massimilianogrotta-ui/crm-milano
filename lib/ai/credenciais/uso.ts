/**
 * Uso ativo: versão publicada de agente não arquivado. A FK de exclusão é mais
 * abrangente: conta toda versão com `contarReferencias`.
 *
 * Consumida pela tela (`app/app/ai/credentials/page.tsx`) e pelo
 * `DELETE /api/v1/ai/credentials/:id`. Enquanto eram duas cópias, divergiram.
 */
export interface AgenteResumo {
  archived_at: string | null;
  published_version_id: string | null;
}

export interface VersaoVinculada {
  id: string;
  credential_id: string;
  /** O PostgREST devolve objeto ou array conforme a cardinalidade inferida. */
  ai_agents: AgenteResumo | AgenteResumo[] | null;
}

export function contarUsoPublicado(linhas: VersaoVinculada[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const linha of linhas) {
    const agente = Array.isArray(linha.ai_agents) ? linha.ai_agents[0] : linha.ai_agents;
    if (!agente || agente.archived_at) continue;
    if (agente.published_version_id !== linha.id) continue;
    mapa[linha.credential_id] = (mapa[linha.credential_id] ?? 0) + 1;
  }
  return mapa;
}

/** A FK protege toda versão, inclusive rascunhos e histórico de agentes arquivados. */
export function contarReferencias(linhas: Pick<VersaoVinculada, "credential_id">[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  for (const linha of linhas) mapa[linha.credential_id] = (mapa[linha.credential_id] ?? 0) + 1;
  return mapa;
}
