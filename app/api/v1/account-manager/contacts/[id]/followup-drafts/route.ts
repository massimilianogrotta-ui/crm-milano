/**
 * POST /api/v1/account-manager/contacts/:id/followup-drafts — salva una BOZZA (am:write).
 * Nessun invio: la tabella non è letta da nessun worker di spedizione.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { createDraft } from "@/lib/account-manager/data";
import { readBody, readId, withAccountManager } from "@/lib/account-manager/guard";
import { createDraftBody } from "@/lib/account-manager/schemas";

export const dynamic = "force-dynamic";

export function POST(req: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAccountManager(req, "write", async (ctx) => {
    const id = readId((await route.params).id, ctx.requestId);
    const body = await readBody(req, createDraftBody, ctx.requestId);
    return ok(await createDraft(ctx, id, body), { requestId: ctx.requestId, status: 201 });
  });
}
