/**
 * O idioma da interface — o mínimo que faz a escolha SIGNIFICAR alguma coisa.
 *
 * ─── O que existia antes ───────────────────────────────────────────────────
 *
 * Um seletor de idioma no perfil, salvo em `user_metadata.locale`, que NINGUÉM
 * lia. Medido: nenhuma biblioteca de i18n instalada, nenhuma pasta de tradução,
 * nenhum consumidor do campo. Escolher "English (US)" não mudava uma letra.
 *
 * Isso é pior que não ter a opção: o operador escolhe, nada acontece, e ele
 * conclui que o sistema está quebrado — a mesma classe do rodapé que mostra uma
 * versão que não é a que roda.
 *
 * ─── Por que dicionário próprio, e não uma biblioteca ──────────────────────
 *
 * As bibliotecas de i18n do App Router pedem o idioma no CAMINHO da URL
 * (`/es/app/inbox`), o que mexeria em TODA rota do produto — links salvos,
 * webhooks, redirects, testes e2e. Risco enorme para uma tradução parcial.
 *
 * Aqui o idioma vem de quem está logado e o texto é resolvido em memória. Nada
 * de rota muda, e a tradução pode crescer tela a tela sem nenhuma migração.
 *
 * ─── Já foi parcial. Não é mais, e agora há um guarda dizendo isso ─────────
 *
 * Esta seção dizia, com números, que a tradução cobria "o que a equipe usa todo
 * dia — inbox, kanban, contatos, conexões" e que o resto seguia em português.
 * Era verdade quando foi escrita e venceu: o PR #352 cobriu IA e Admin, e o
 * passe seguinte fechou Agenda, Desempenho, Radar e Respostas rápidas.
 *
 * O que substitui a frase não é outro número — números envelhecem calados. É um
 * guarda: `tests/unit/i18n-espanhol-cobre-a-tela` varre o AST de toda tela e
 * reprova prosa portuguesa que não passe por `t()`, mais toda chave usada sem
 * tradução. Para saber o estado agora, rode-o; ele não tem como estar
 * desatualizado.
 *
 * A cobertura de TEXTO é completa. A de DATA não: `locale: ptBR` é passado à
 * mão em dezenas de arquivos, e trocar isso é um passe próprio. A ressalva está
 * no cabeçalho do guarda, com o comando que a re-mede.
 *
 * ─── De onde vem o idioma de quem está olhando ─────────────────────────────
 *
 * Não é só do perfil. A cadeia é `preferência da pessoa → idioma da organização
 * → padrão`, resolvida em `lib/auth/server.ts` e entregue pronta em
 * `AuthUser.idioma`. É o elo do meio que faz o idioma escolhido no instalador
 * alcançar quem entra depois e nunca abriu o próprio perfil.
 */

export const IDIOMAS = ["pt-BR", "es", "it", "en"] as const;
export type Idioma = (typeof IDIOMAS)[number];

/**
 * O default do IDIOMA agora fala: `APP_LOCALE` no `.env` (idioma padrão da
 * INSTALAÇÃO — All-io põe `it`, Radio Banana `es`). Antes era hardcoded
 * `pt-BR` e o `.env` da instalação era ignorado: a tela de login/signup
 * nascia portuguesa mesmo onde a instalação inteira fala outra língua.
 *
 * A prioridade do VISITANTE continua vencendo o `.env` (a instalação escolhe
 * o FALLBACK, não a língua de cada pessoa): Accept-Language do navegador →
 * `APP_LOCALE` → `pt-BR` (histórico). Usuário logado segue a cadeia
 * preferência → organização → default da instalação, em `lib/auth/server.ts`.
 */
export const IDIOMA_PADRAO: Idioma = "pt-BR";

/** Lê o default da instalação de uma vez, sem ler o `.env` em cada render. */
export function idiomaDaInstalacao(): Idioma {
  const bruto = process.env.APP_LOCALE ?? "";
  return normalizar(bruto);
}

/**
 * O que veio do perfil é um idioma que sabemos servir?
 *
 * Fecha para o padrão em vez de confiar: o campo aceita qualquer string desde
 * antes desta feature (o seletor já ofereceu `en-US`, que nunca teve tradução),
 * e um valor desconhecido chegando ao dicionário devolveria a CHAVE na tela.
 */
function normalizar(bruto: string | null | undefined): Idioma {
  return (IDIOMAS as readonly string[]).includes(bruto ?? "")
    ? (bruto as Idioma)
    : IDIOMA_PADRAO;
}

/** Mantida pública: callers existentes e testes usam o nome histórico. */
export function normalizarIdioma(bruto: string | null | undefined): Idioma {
  return normalizar(bruto);
}

/**
 * A língua de quem CHEGA (sem sessão, sem preferência gravada): o primeiro
 * idioma suportado no `Accept-Language` do navegador; se nada casa, o default
 * da instalação. Serve telas públicas (login, signup) e páginas de erro —
 * onde não existe quem pergunte ao banco.
 */
export function idiomaDoVisitante(acceptLanguage: string | null | undefined): Idioma {
  if (!acceptLanguage) return idiomaDaInstalacao();
  const pedidos = acceptLanguage
    .split(",")
    .map((parte) => {
      const [tagBruto, qBruto] = parte.trim().split(";q=");
      const tag = (tagBruto ?? "").trim();
      const q = qBruto ? parseFloat(qBruto) : 1;
      return { tag, q };
    })
    .filter((p) => p.tag !== "" && Number.isFinite(p.q))
    .sort((a, b) => b.q - a.q);
  for (const { tag } of pedidos) {
    const exato = (IDIOMAS as readonly string[]).find(
      (i) => i.toLowerCase() === tag,
    );
    if (exato) return exato as Idioma;
    const prefixo = (IDIOMAS as readonly string[]).find((i) =>
      tag.startsWith(`${i.toLowerCase()}-`),
    );
    // `pt-PT` casa com pt-BR (mesmo dicionário), `es-EC` com es, etc.
    if (prefixo) return prefixo as Idioma;
    const base = tag.split("-")[0];
    const porBase = (IDIOMAS as readonly string[]).find(
      (i) => i.toLowerCase() === base,
    );
    if (porBase) return porBase as Idioma;
  }
  return idiomaDaInstalacao();
}
