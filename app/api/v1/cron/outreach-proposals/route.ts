/**
 * GET /api/v1/cron/outreach-proposals
 *
 * Agente outreach All-io (P0): prepara bozze email nella coda "Da approvare".
 * NON invia nulla. Org fissata da OUTREACH_ORG_ID (vuota = spento).
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fail-closed).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { autorizaCron } from "@/lib/auth/cron-auth";

import { ok, fail } from "@/lib/api/wrappers";
import { logger } from "@/lib/logger";
import { outreachOrgId } from "@/lib/outreach/config";
import { nellaFinestraOutreachRoma } from "@/lib/outreach/day";
import { generaProposte } from "@/lib/outreach/generate";
import { bloccaOutreach } from "@/lib/outreach/lock";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  if (!autorizaCron(req)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const orgId = outreachOrgId();
  if (!orgId) return ok({ stato: "spento" }, { requestId });

  if (!nellaFinestraOutreachRoma(new Date())) return ok({ stato: "fuori_orario" }, { requestId });

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
