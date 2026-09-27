/** GET /api/v1/account-manager/leads — trattative con stato, valore, prossimo passo, ultimo movimento (am:read). */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { listLeads } from "@/lib/account-manager/data";
import { readQuery, withAccountManager } from "@/lib/account-manager/guard";
import { listLeadsQuery } from "@/lib/account-manager/schemas";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest): Promise<Response> {
  return withAccountManager(req, "read", async (ctx) => {
    const q = readQuery(req, listLeadsQuery, ctx.requestId);
    const { items, totale } = await listLeads(ctx, q);
    return ok(items, { requestId: ctx.requestId, meta: { totale, limit: q.limit, offset: q.offset } });
  });
}
