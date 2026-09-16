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
import { outreachOrgId } from "@/lib/outreach/config";
import { generaProposte } from "@/lib/outreach/generate";
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

  const esito = await generaProposte(createAdminClient(), orgId);
  return ok(esito, { requestId });
}