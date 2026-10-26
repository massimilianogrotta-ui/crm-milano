export type Segmento = "dentista" | "estetica" | "generico";
export type OutreachKind = "first_contact" | "followup";

/** Firma e nome mittente. Una sola stringa: i due non possono divergere. */
export const OUTREACH_SIGNATURE = "Massi · All-io CRM Assist";

export function segmentoDelLead(lead: { title: string | null; tags: string[] | null }): Segmento {
  const testo = [lead.title ?? "", ...(lead.tags ?? [])].join(" ").toLowerCase();
  if (/dent|odont|ortodon/.test(testo)) return "dentista";
  if (/estetic|beauty|bellezza/.test(testo)) return "estetica";
  return "generico";
}

const CHI: Record<Segmento, { pazienti: string }> = {
  dentista: { pazienti: "pazienti" },
  estetica: { pazienti: "clienti" },
  generico: { pazienti: "clienti" },
};

function pulisci(nome: string): string {
  return nome.replace(/[<>"\r\n]/g, "").trim().slice(0, 120);
}

export function renderOutreach(input: {
  kind: OutreachKind;
  segmento: Segmento;
  nomeStudio: string;
}): { templateRef: string; subject: string; body: string } {
  const nome = pulisci(input.nomeStudio);
  const c = CHI[input.segmento];

  if (input.kind === "first_contact") {
    return {
      templateRef: `first_contact.${input.segmento}.v3`,
      subject: `${nome}: contatti, appuntamenti e follow-up ${c.pazienti}`,
      body: [
        "Buongiorno,",
        "",
        `mi chiamo Massi e lavoro con All-io. Le scrivo perché ${nome} potrebbe trovare utile All-io CRM Assist: uno strumento per gestire contatti, appuntamenti e follow-up dei ${c.pazienti}, senza cambiare gestionale. Se ne usate già uno, lo colleghiamo.`,
        "",
        "L'agente prepara i messaggi, lei li autorizza: nulla parte senza il suo ok.",
        "",
        "Le andrebbe una breve demo di 10 minuti nei prossimi giorni?",
        "",
        "Cordiali saluti,",
        OUTREACH_SIGNATURE,
        "",
        "Se preferisce non ricevere altre email, risponda STOP.",
      ].join("\n"),
    };
  }

  return {
    templateRef: `wa.followup.${input.segmento}.v2`,
    subject: "Sollecito WhatsApp",
    body: [
      "Buongiorno,",
      `Le avevo scritto per mostrarLe una breve demo su agenda e ritorni dei ${c.pazienti}.`,
      "Se desidera, può vederla qui: https://demo-mini.all-io.com",
      "",
      "Se non desidera altri messaggi, può rispondere STOP.",
      "",
      "— Max · All-io · Milano",
    ].join("\n"),
  };
}
