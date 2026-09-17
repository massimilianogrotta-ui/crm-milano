"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { decidiProposta, modificaProposta } from "@/app/actions/outreach/decide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

/**
 * Códigos técnicos que `decide.ts` e `execute.ts` devolvem, mapeados para a
 * frase em português que `t()` sabe traduzir — mesmo padrão de
 * `app/app/settings/tenant/_danger-zone.tsx`. Um código sem entrada aqui (ex.:
 * erro dinâmico do provedor de e-mail) passa direto por `t()`, que devolve o
 * próprio texto sem tradução — nunca português cru, porque nunca É português.
 */
const ERRO_EM_PORTUGUES: Record<string, string> = {
  unauthenticated: "Sua sessão expirou. Entre de novo para continuar.",
  forbidden: "Você não tem permissão para esta ação.",
  forbidden_tenant: "Não consegui identificar sua empresa. Recarregue a página.",
  forbidden_role: "Você não tem permissão para esta ação.",
  not_found: "Proposta não encontrada.",
  validation_failed: "Confira os campos: algum valor não está no formato esperado.",
  non_pending: "Esta proposta já foi decidida.",
  send_failed: "Não consegui enviar o e-mail agora.",
  contatto_bloccato: "Contato bloqueado — envio de mensagens desabilitado.",
};

export interface RigaCoda {
  id: string;
  status: string;
  kind: string;
  to_address: string;
  subject: string | null;
  body: string;
  reason: string;
  dry_run: boolean;
  created_at: string;
  decided_at: string | null;
  error: string | null;
  leadTitle: string;
}

export function OutreachQueue({ righe }: { righe: RigaCoda[] }) {
  const t = useT();
  const pending = righe.filter((r) => r.status === "pending");
  const storico = righe.filter((r) => r.status !== "pending");

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        {pending.length === 0 && <p className="text-sm text-muted-foreground">{t("Nenhum e-mail para aprovar.")}</p>}
        {pending.map((r) => (
          <Scheda key={r.id} riga={r} />
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("Histórico")}</h2>
        {storico.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <Badge variant="outline">{t(r.status === "sent" && r.dry_run ? "Teste" : r.status)}</Badge>
            <span className="font-medium">{r.leadTitle}</span>
            <span className="text-muted-foreground">{r.subject}</span>
            {r.error && (
              <span className="text-destructive">{t(ERRO_EM_PORTUGUES[r.error] ?? r.error)}</span>
            )}
          </div>
        ))}
      </section>
    </div>
  );
}

function Scheda({ riga }: { riga: RigaCoda }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [modifica, setModifica] = useState(false);
  const [subject, setSubject] = useState(riga.subject ?? "");
  const [body, setBody] = useState(riga.body);

  const esegui = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(t(r.error ? (ERRO_EM_PORTUGUES[r.error] ?? r.error) : "erro"));
    });

  return (
    <article className="rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">{riga.leadTitle}</span>
        <Badge variant="secondary">{t(riga.kind === "first_contact" ? "Primeiro contato" : "Follow-up")}</Badge>
        <span className="text-sm text-muted-foreground">{riga.to_address}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{riga.reason}</p>
      {modifica ? (
        <div className="flex flex-col gap-2">
          <input className="rounded-md border px-2 py-1" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="min-h-48 rounded-md border px-2 py-1" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      ) : (
        <>
          <p className="font-medium">{riga.subject}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm">{riga.body}</pre>
        </>
      )}
      <div className="mt-3 flex gap-2">
        {modifica ? (
          <Button disabled={pending} onClick={() => esegui(async () => { const r = await modificaProposta(riga.id, subject, body); if (r.ok) setModifica(false); return r; })}>
            {t("Salvar")}
          </Button>
        ) : (
          <>
            <Button disabled={pending} onClick={() => esegui(() => decidiProposta(riga.id, "approva"))}>{t("Aprovar")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => setModifica(true)}>{t("Editar")}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => esegui(() => decidiProposta(riga.id, "rifiuta"))}>{t("Recusar")}</Button>
          </>
        )}
      </div>
    </article>
  );
}