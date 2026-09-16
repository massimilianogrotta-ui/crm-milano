export type Segmento = "dentista" | "estetica" | "generico";
export type OutreachKind = "first_contact" | "followup";

export function segmentoDelLead(lead: { title: string | null; tags: string[] | null }): Segmento {
  const testo = [lead.title ?? "", ...(lead.tags ?? [])].join(" ").toLowerCase();
  if (/dent|odont|ortodon/.test(testo)) return "dentista";
  if (/estetic|beauty|bellezza/.test(testo)) return "estetica";
  return "generico";
}

const CTA_DEMO = "https://demo-mini.all-io.com";
const CTA_WA = "https://wa.me/393780699002";

const CHI: Record<Segmento, { aiuto: string; pazienti: string; luogo: string }> = {
  dentista: { aiuto: "studi dentali", pazienti: "pazienti", luogo: "dello studio" },
  estetica: { aiuto: "cliniche e centri estetici", pazienti: "clienti", luogo: "del centro" },
  generico: { aiuto: "studi e centri di Milano", pazienti: "clienti", luogo: "della struttura" },
};

function pulisci(nome: string): string {
  return nome.replace(/[<>"\r\n]/g, "").trim().slice(0, 120);
}

function footer(nomeStudio: string, luogo: string): string {
  return [
    "— Max · All-io · Milano",
    "",
    `Ricevi questa email come titolare/responsabile ${luogo} «${nomeStudio}».`,
    'Non vuoi più riceverle? Rispondi con "STOP".',
  ].join("\n");
}

export function renderOutreach(input: {
  kind: OutreachKind;
  segmento: Segmento;
  nomeStudio: string;
}): { templateRef: string; subject: string; body: string } {
  const nome = pulisci(input.nomeStudio);
  const c = CHI[input.segmento];
  const templateRef = `${input.kind}.${input.segmento}.v1`;

  if (input.kind === "first_contact") {
    return {
      templateRef,
      subject: `Demo 10 min — agenda e ritorni ${c.pazienti} (senza cambiare gestionale)`,
      body: [
        "Buongiorno,",
        `sono Max di All-io: aiuto ${c.aiuto} a ridurre i buchi in agenda e i mancati ritorni dei ${c.pazienti}.`,
        "",
        "In concreto, senza cambiare il vostro gestionale:",
        "promemoria, richiami e prenotazioni su WhatsApp, installati da me in un giorno.",
        "Voi non toccate nulla. Costo fisso mensile, niente canoni nascosti.",
        "",
        `Le va di vedere una demo di 10 minuti questa settimana? Può provarla qui: ${CTA_DEMO}`,
        `oppure scrivermi su WhatsApp: ${CTA_WA}`,
        "",
        footer(nome, c.luogo),
      ].join("\n"),
    };
  }

  return {
    templateRef,
    subject: "Re: demo 10 min All-io",
    body: [
      "Buongiorno,",
      `le avevo scritto la settimana scorsa per una demo di 10 minuti su agenda e ritorni dei ${c.pazienti}.`,
      "Se non è il momento nessun problema: mi basta un sì o un no.",
      "",
      `Demo: ${CTA_DEMO} · WhatsApp: ${CTA_WA}`,
      "",
      footer(nome, c.luogo),
    ].join("\n"),
  };
}