/**
 * Contratti dell'API Account manager. Tutto ciò che non è qui NON è esposto:
 * niente cancellazioni, niente import/export in blocco, niente invii.
 */
import { z } from "zod";

/** uuid "largo": gli id del CRM non sono tutti v4 (semi, import). */
const uuid = () => z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, "uuid");

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}(T.*)?$/, "Data ISO (YYYY-MM-DD)");

export const listContactsQuery = z.object({
  nome: z.string().trim().min(1).max(100).optional(),
  azienda: z.string().trim().min(1).max(100).optional(),
  tag: z.string().trim().min(1).max(60).optional(),
  ultimo_contatto_dal: isoDate.optional(),
  ultimo_contatto_al: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const listLeadsQuery = z.object({
  stato: z.enum(["open", "won", "lost"]).optional(),
  contact_id: uuid().optional(),
  pipeline_id: uuid().optional(),
  stage_id: uuid().optional(),
  mossi_dal: isoDate.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).max(10000).default(0),
});

export const createContactBody = z
  .object({
    nome: z.string().trim().min(1).max(200),
    azienda: z.string().trim().min(1).max(200).optional(),
    email: z.string().email().optional(),
    telefono: z.string().regex(/^\+\d{8,15}$/, "Formato E.164, es. +393331234567").optional(),
    tag: z.array(z.string().trim().min(1).max(60)).max(20).optional(),
  })
  .strict();

export const addNoteBody = z
  .object({
    tipo: z.enum(["nota", "attivita"]).default("nota"),
    titolo: z.string().trim().min(1).max(200).optional(),
    testo: z.string().trim().min(1).max(5000),
    /** Obbligatorio per `attivita`: l'attività va sulla timeline della trattativa. */
    lead_id: uuid().optional(),
  })
  .strict()
  .refine((b) => b.tipo === "nota" || !!b.lead_id, {
    message: "lead_id obbligatorio per tipo=attivita",
    path: ["lead_id"],
  });

export const updateLeadBody = z
  .object({
    /** Sposta la trattativa in un'altra fase della stessa pipeline. */
    stage_id: uuid().optional(),
    /**
     * Chiude la trattativa. `lost` richiede `motivo`: uno dei codici del CRM
     * (price, no_response, requested_by_customer, product_unavailable,
     * cancelled_by_customer, other, …) oppure testo libero, che viene salvato
     * come `other` con il testo nello storico.
     */
    esito: z.enum(["won", "lost"]).optional(),
    motivo: z.string().trim().min(1).max(500).optional(),
    prossimo_passo: z.string().trim().max(500).nullable().optional(),
    prossimo_passo_entro: isoDate.nullable().optional(),
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, { message: "Corpo vuoto" })
  .refine((b) => !(b.stage_id && b.esito), { message: "stage_id ed esito insieme non ammessi" })
  .refine((b) => b.esito !== "lost" || !!b.motivo, { message: "motivo obbligatorio per esito=lost", path: ["motivo"] });

export const createDraftBody = z
  .object({
    canale: z.enum(["email", "whatsapp", "altro"]).default("email"),
    oggetto: z.string().trim().min(1).max(300).optional(),
    testo: z.string().trim().min(1).max(10000),
    lead_id: uuid().optional(),
  })
  .strict();
