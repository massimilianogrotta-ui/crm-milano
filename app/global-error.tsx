"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, useMemo, useState } from "react";

import { copyToClipboard } from "@/lib/clipboard";
import { traduzir } from "@/lib/i18n/dicionario";
import { idiomaDoVisitante } from "@/lib/i18n/idiomas";

/**
 * Não há provider de idioma aqui: este boundary dispara justamente quando
 * ELE já falhou, e chamar outro hook de contexto é o mesmo risco que causou
 * o erro original. `traduzir()` é função pura (não hook) — segura de chamar
 * aqui. `idiomaDoVisitante()` já existe para exatamente este caso ("páginas
 * de erro — onde não existe quem pergunte ao banco"); a única adaptação é
 * que aqui não há `Accept-Language` de request (client puro), então usamos
 * `navigator.languages` como a lista de preferências no mesmo formato.
 */
function idiomaDoErro() {
  if (typeof navigator === "undefined") return idiomaDoVisitante(null);
  const preferencias = (navigator.languages && navigator.languages.length > 0
    ? navigator.languages
    : [navigator.language]
  ).join(",");
  return idiomaDoVisitante(preferencias);
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [eventId, setEventId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const idioma = useMemo(idiomaDoErro, []);
  const t = (texto: string) => traduzir(texto, idioma);

  useEffect(() => {
    const id = Sentry.captureException(error);
    setEventId(id);
  }, [error]);

  const displayId = eventId ?? error.digest ?? "—";

  return (
    <html lang={idioma}>
      <body
        style={{
          margin: 0,
          fontFamily:
            "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
          background: "#fafaf9",
          color: "#1c1917",
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "2rem",
        }}
      >
        <div
          style={{
            maxWidth: 480,
            width: "100%",
            background: "white",
            border: "1px solid #e7e5e4",
            borderRadius: 12,
            padding: "2rem",
            textAlign: "center",
          }}
        >
          <h1 style={{ fontSize: "1.5rem", margin: "0 0 0.5rem", fontWeight: 600 }}>
            {t("Algo deu errado")}
          </h1>
          <p style={{ color: "#57534e", margin: "0 0 1.5rem" }}>
            {t("Tente novamente em instantes. Se persistir, contate o suporte com o ID abaixo.")}
          </p>
          <div
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "0.75rem",
              background: "#f5f5f4",
              padding: "0.5rem",
              borderRadius: 6,
              marginBottom: "1rem",
              wordBreak: "break-all",
            }}
          >
            ID: {displayId}
          </div>
          <div style={{ display: "flex", gap: "0.5rem", justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => {
                void copyToClipboard(displayId).then((ok) => {
                  if (ok) {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                });
              }}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #d6d3d1",
                background: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {copied ? t("Copiado!") : t("Copiar ID")}
            </button>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                padding: "0.5rem 1rem",
                border: "1px solid #1c1917",
                background: "#1c1917",
                color: "white",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {t("Tentar de novo")}
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
