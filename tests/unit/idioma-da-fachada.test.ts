import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * A FACHADA DE ACESSO fala uma língua só.
 *
 * Achado em produção (crm.all-io.com, instalação `it`): `/login/forgot` mostrava
 * "Recuperar senha" e "Informe seu e-mail…" em português, embaixo do aviso de
 * confirmação já em italiano. A casca (`app/(public)/layout.tsx`) lia o
 * navegador; a página lia só o perfil — e sem sessão, `normalizarIdioma(null)`
 * é `pt-BR`. Duas regras para a mesma tela, e o visitante via as duas.
 *
 * Estes casos prendem a regra (`idiomaDaFachada`) e que TODA tela do grupo a
 * use, inclusive no título da aba.
 */
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDaFachada } from "@/lib/i18n/idiomas";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("idiomaDaFachada", () => {
  it("sem sessão, fala a língua do navegador", () => {
    expect(idiomaDaFachada(null, "it-IT,it;q=0.9,en;q=0.8")).toBe("it");
  });

  it("perfil com idioma servido vence o navegador", () => {
    expect(idiomaDaFachada("es", "it-IT,it;q=0.9")).toBe("es");
  });

  it("perfil sem idioma, ou com um que não servimos, cai no navegador — não em pt-BR", () => {
    expect(idiomaDaFachada(undefined, "it-IT")).toBe("it");
    expect(idiomaDaFachada("en-US", "it-IT")).toBe("it");
  });

  it("sem navegador nem perfil, vale o default da instalação", () => {
    vi.stubEnv("APP_LOCALE", "it");
    expect(idiomaDaFachada(null, null)).toBe("it");
  });

  it("os textos de /login/forgot existem em italiano", () => {
    expect(traduzir("Recuperar senha", "it")).toBe("Recupera password");
    expect(traduzir("Informe seu e-mail e enviaremos um link de redefinição", "it")).not.toBe(
      "Informe seu e-mail e enviaremos um link de redefinição",
    );
    expect(traduzir("Lembrou a senha?", "it")).toBe("Hai ricordato la password?");
  });
});

describe("toda tela de acesso usa a mesma regra", () => {
  const telas = [
    "app/(public)/layout.tsx",
    "app/(public)/login/page.tsx",
    "app/(public)/login/forgot/page.tsx",
    "app/(public)/login/reset/page.tsx",
    "app/(public)/login/recovery/page.tsx",
    "app/(public)/login/mfa/page.tsx",
    "app/(public)/signup/page.tsx",
  ];

  it.each(telas)("%s resolve o idioma por idiomaDaFachada", (arquivo) => {
    const fonte = readFileSync(arquivo, "utf8");
    expect(fonte).toMatch(/idiomaDaFachada\(/);
    expect(fonte, "voltou a resolver só pelo perfil").not.toMatch(/normalizarIdioma\(/);
  });

  it.each(telas.filter((t) => t.endsWith("page.tsx")))(
    "%s não tem título de aba fixo em português",
    (arquivo) => {
      expect(readFileSync(arquivo, "utf8")).not.toMatch(/export const metadata = \{ title: "/);
    },
  );
});
