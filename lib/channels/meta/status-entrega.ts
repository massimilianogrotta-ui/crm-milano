/**
 * Status de entrega do canal oficial, só para a frente.
 *
 * `read` não volta a `delivered`, e `failed` não pisa numa entrega que já
 * aconteceu. A garantia é o filtro do UPDATE (`status IN anteriores`), não uma
 * leitura seguida de escrita: dois webhooks simultâneos não se desfazem.
 *
 * Status que o produto não conhece não é escrito. Tratar "qualquer coisa" como
 * `sent` fazia um evento novo parecer entrega.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

const ANTERIORES: Record<string, readonly string[]> = {
  sent: ["queued", "sending", "received"],
  delivered: ["queued", "sending", "received", "sent"],
  read: ["queued", "sending", "received", "sent", "delivered"],
  // Falha depois de entregue ou lida não desfaz o que o contato já viu.
  failed: ["queued", "sending", "received", "sent"],
};

export function statusAnterioresPermitidos(recebido: string): readonly string[] | null {
  return ANTERIORES[recebido] ?? null;
}

export async function aplicarStatusDeEntrega(
  db: SupabaseClient,
  input: { organizationId: string; externalId: string; status: string; agora?: string },
): Promise<"aplicado" | "ignorado"> {
  const anteriores = statusAnterioresPermitidos(input.status);
  if (!anteriores || !input.externalId) return "ignorado";

  const agora = input.agora ?? new Date().toISOString();
  const patch: Record<string, string> = { status: input.status, updated_at: agora };
  if (input.status === "delivered") patch.delivered_at = agora;
  if (input.status === "read") patch.read_at = agora;

  await db
    .from("messages")
    .update(patch)
    .eq("organization_id", input.organizationId)
    .eq("external_id", input.externalId)
    .in("status", [...anteriores]);

  return "aplicado";
}
