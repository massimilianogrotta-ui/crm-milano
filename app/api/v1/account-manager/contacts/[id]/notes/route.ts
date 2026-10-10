/** POST /api/v1/account-manager/contacts/:id/notes — aggiunge nota o attività (am:write). */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { addNote } from "@/lib/account-manager/data";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { readBody, readId, withAccountManager } from "@/lib/account-manager/guard";
import { addNoteBody } from "@/lib/account-manager/schemas";

export const dynamic = "force-dynamic";

export function POST(req: NextRequest, route: { params: Promise<{ id: string }> }): Promise<Response> {
  return withAccountManager(req, "write", async (ctx) => {
    const supportDenied = await requireSupportWrite();
    if (supportDenied) return supportDenied;
    const id = readId((await route.params).id, ctx.requestId);
    const body = await readBody(req, addNoteBody, ctx.requestId);
    return ok(await addNote(ctx, id, body), { requestId: ctx.requestId, status: 201 });
  });
}
