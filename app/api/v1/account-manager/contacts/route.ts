/**
 * GET  /api/v1/account-manager/contacts — cerca/lista contatti (am:read).
 * POST /api/v1/account-manager/contacts — crea UN contatto (am:write).
 * Nessun import in blocco: il corpo è un solo contatto.
 */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { createContact, listContacts } from "@/lib/account-manager/data";
import { requireSupportWrite } from "@/lib/impersonate/support";
import { readBody, readQuery, withAccountManager } from "@/lib/account-manager/guard";
import { createContactBody, listContactsQuery } from "@/lib/account-manager/schemas";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest): Promise<Response> {
  return withAccountManager(req, "read", async (ctx) => {
    const q = readQuery(req, listContactsQuery, ctx.requestId);
    const { items, totale } = await listContacts(ctx, q);
    return ok(items, { requestId: ctx.requestId, meta: { totale, limit: q.limit, offset: q.offset } });
  });
}

export function POST(req: NextRequest): Promise<Response> {
  return withAccountManager(req, "write", async (ctx) => {
    const supportDenied = await requireSupportWrite();
    if (supportDenied) return supportDenied;
    const body = await readBody(req, createContactBody, ctx.requestId);
    return ok(await createContact(ctx, body), { requestId: ctx.requestId, status: 201 });
  });
}
