/** GET /api/v1/account-manager/contacts/:id — dettaglio con trattative, storico, note, bozze (am:read). */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { getContactDetail } from "@/lib/account-manager/data";
import { readId, withAccountManager } from "@/lib/account-manager/guard";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAccountManager(req, "read", async (ctx) => {
    const id = readId((await route.params).id, ctx.requestId);
    return ok(await getContactDetail(ctx, id), { requestId: ctx.requestId });
  });
}
