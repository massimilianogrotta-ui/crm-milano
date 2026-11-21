import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import GlobalError from "@/app/global-error";

// `idiomaDoErro` não é exportada (e não deve ser: global-error é arquivo
// especial do Next). Prova-se pelo efeito visível: o `lang` do <html>.
// renderToStaticMarkup não roda efeitos, então o Sentry nunca é chamado.
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

function langRenderizado(): string | undefined {
  const html = renderToStaticMarkup(
    <GlobalError error={new Error("falha")} reset={() => {}} />,
  );
  return /<html lang="([^"]+)"/.exec(html)?.[1];
}

describe("idiomaDoErro (via GlobalError)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("usa as línguas do navegador quando existem", () => {
    vi.stubGlobal("navigator", { languages: ["it-IT", "en"], language: "en" });
    expect(langRenderizado()).toBe("it");
  });

  it("cai em navigator.language quando languages está vazio", () => {
    vi.stubGlobal("navigator", { languages: [], language: "es-MX" });
    expect(langRenderizado()).toBe("es");
  });

  it("usa o idioma da instalação quando navigator está ausente", () => {
    vi.stubEnv("APP_LOCALE", "en");
    vi.stubGlobal("navigator", undefined);
    expect(langRenderizado()).toBe("en");
  });
});
