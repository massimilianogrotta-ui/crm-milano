/** GET /api/v1/account-manager/stages — fasi valide per spostare una trattativa (am:read). */
import type { NextRequest } from "next/server";

import { ok } from "@/lib/api/wrappers";
import { listStages } from "@/lib/account-manager/data";
import { withAccountManager } from "@/lib/account-manager/guard";

export const dynamic = "force-dynamic";

export function GET(req: NextRequest): Promise<Response> {
  return withAccountManager(req, "read", async (ctx) => ok(await listStages(ctx), { requestId: ctx.requestId }));
}
