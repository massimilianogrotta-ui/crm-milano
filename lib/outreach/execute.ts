import type { OutreachKind } from "@/lib/outreach/templates";

export interface PropostaDaEseguire {
  id: string;
  organizationId: string;
  leadId: string;
  contactId: string | null;
  kind: OutreachKind;
  status: string;
  toAddress: string;
  subject: string | null;
  body: string;
  contactBlocked: boolean;
}

export interface DipendenzeEsecuzione {
  dryRun: boolean;
  send: (args: { to: string; subject: string; text: string; html: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /**
   * Aggiorna la proposta SOLO se lo stato atteso corrisponde (trava ottimista).
   * Ritorna false se un altro utente l'ha già decisa.
   */
  salva: (patch: Record<string, unknown> & { expectStatus: string }) => Promise<boolean>;
  spostaInAttesa: () => Promise<"movido" | "non_in_da_contattare" | "errore">;
  nota: (testo: string) => Promise<void>;
}

export type Decisione = { azione: "approva" | "rifiuta"; userId: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function eseguiDecisione(
  p: PropostaDaEseguire,
  d: Decisione,
  deps: DipendenzeEsecuzione,
): Promise<{ status: "rejected" | "sent" | "failed" | "non_pending"; errore?: string }> {
  if (p.status !== "pending") return { status: "non_pending" };
  const ora = new Date().toISOString();

  if (d.azione === "rifiuta" || p.contactBlocked) {
    const ok = await deps.salva({
      expectStatus: "pending",
      status: "rejected",
      decided_by: d.userId,
      decided_at: ora,
      error: p.contactBlocked ? "contatto_bloccato" : null,
    });
    return ok ? { status: "rejected" } : { status: "non_pending" };
  }

  // Blocca la proposta prima di inviare: due clic non producono due email.
  const preso = await deps.salva({ expectStatus: "pending", status: "approved", decided_by: d.userId, decided_at: ora, dry_run: deps.dryRun });
  if (!preso) return { status: "non_pending" };

  let providerId: string | null = null;
  if (!deps.dryRun) {
    const r = await deps.send({
      to: p.toAddress,
      subject: p.subject ?? "",
      text: p.body,
      html: `<div style="white-space:pre-line;font-family:sans-serif">${escapeHtml(p.body)}</div>`,
    });
    if (!r.ok) {
      await deps.salva({ expectStatus: "approved", status: "failed", error: r.error ?? "send_failed" });
      return { status: "failed", errore: r.error };
    }
    providerId = r.id ?? null;
  }

  await deps.salva({
    expectStatus: "approved",
    status: "sent",
    sent_at: new Date().toISOString(),
    provider_message_id: providerId,
    dry_run: deps.dryRun,
  });
  if (p.kind === "first_contact") await deps.spostaInAttesa();
  const etichetta = p.kind === "first_contact" ? "Primo contatto" : "Ricontatto";
  await deps.nota(
    deps.dryRun
      ? `${etichetta} email approvato (modalità prova: nessun invio reale). Oggetto: ${p.subject ?? ""}`
      : `${etichetta} email inviato. Oggetto: ${p.subject ?? ""}`,
  );
  return { status: "sent" };
}