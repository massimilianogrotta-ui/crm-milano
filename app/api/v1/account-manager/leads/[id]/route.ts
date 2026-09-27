/** PATCH /api/v1/account-manager/leads/:id — fase/esito e prossimo passo (am:write). */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { updateLead } from "@/lib/account-manager/data";
import { readBody, readId, withAccountManager } from "@/lib/account-manager/guard";
import { updateLeadBody } from "@/lib/account-manager/schemas";

export const dynamic = "force-dynamic";

export function PATCH(req: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAccountManager(req, "write", async (ctx) => {
    const id = readId((await route.params).id, ctx.requestId);
    const body = await readBody(req, updateLeadBody, ctx.requestId);
    return ok(await updateLead(ctx, id, body), { requestId: ctx.requestId });
  });
}
