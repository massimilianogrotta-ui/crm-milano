/**
 * GET /api/v1/cron/outreach-proposals
 *
 * Agente outreach All-io (P0): prepara bozze email nella coda "Da approvare".
 * NON invia nulla. Org fissata da OUTREACH_ORG_ID (vuota = spento).
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fail-closed).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { outreachOrgId } from "@/lib/outreach/config";
import { generaProposte } from "@/lib/outreach/generate";
import { bloccaOutreach } from "@/lib/outreach/lock";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted: string[] = [];
  if (env.INTERNAL_CRON_SECRET) accepted.push(env.INTERNAL_CRON_SECRET);
  if (env.INTERNAL_SECRET) accepted.push(env.INTERNAL_SECRET);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const orgId = outreachOrgId();
  if (!orgId) return ok({ stato: "spento" }, { requestId });

  // Fascia oraria Italia: solo tra le 9 e le 19.
  const ora = Number(
    new Intl.DateTimeFormat("it-IT", { hour: "2-digit", hour12: false, timeZone: "Europe/Rome" }).format(new Date()),
  );
  if (ora < 9 || ora >= 19) return ok({ stato: "fuori_orario" }, { requestId });

  try {
    const libera = await bloccaOutreach(orgId);
    if (!libera) return ok({ stato: "occupato" }, { requestId });
    try {
      const esito = await generaProposte(createAdminClient(), orgId);
      return ok(esito, { requestId });
    } catch (e) {
      const errore = e instanceof Error ? e.message : String(e);
      logger.error("[outreach] giro interrotto da eccezione", { organization_id: orgId, error: errore, requestId });
      return fail("internal_error", "Outreach run failed.", 500, { requestId });
    } finally { await libera().catch(() => undefined); }
  } catch {
    return fail("internal_error", "Outreach lock unavailable.", 503, { requestId });
  }
}
