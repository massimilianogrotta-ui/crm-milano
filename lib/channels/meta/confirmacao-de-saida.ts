/**
 * Confirmação em espanhol de quem pediu para sair, só no canal oficial e só
 * enquanto a janela de 24h está aberta.
 *
 * Fora da janela a plataforma recusa texto livre, e mandar um modelo para
 * confirmar a saída seria uma mensagem a mais para quem acabou de pedir
 * silêncio. Sem janela, o bloqueio acontece e nada sai.
 *
 * Só para organização com `phone_default_country = EC` e origem do webhook
 * oficial. Uma instalação brasileira que ouve STOP continua só bloqueando —
 * a frase em espanhol seria comportamento novo para quem não pediu.
 *
 * O envio acontece ANTES de gravar `is_blocked`. O caminho normal de envio
 * recusa contato bloqueado; esta frase é a resposta ao pedido, não uma
 * campanha.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { maskPhone, redactPhones } from "@/lib/phones/mask";
import { paisDaOrganizacao } from "@/lib/phones/pais";

import { metaCloudAdapter } from "../adapters/meta-cloud";
import { CHANNEL_PROVIDER_META } from "../capabilities";
import { estadoDaJanela } from "../janela";

const TEXTO = "Listo. No te enviaremos más mensajes por este canal.";

export async function confirmarSaidaSeJanelaAberta(
  admin: SupabaseClient,
  entrada: {
    organizationId: string;
    contactId: string;
    conversationId: string;
    channelSessionId: string;
    origem: string;
  },
): Promise<void> {
  if (entrada.origem !== "meta_webhook") return;
  if ((await paisDaOrganizacao(admin, entrada.organizationId)) !== "EC") return;

  const { data: conversa } = await admin
    .from("conversations")
    .select("last_inbound_at, channel_session_id")
    .eq("organization_id", entrada.organizationId)
    .eq("id", entrada.conversationId)
    .maybeSingle();

  const sessionId = (conversa?.channel_session_id as string | null) ?? entrada.channelSessionId;
  const { data: sessao } = await admin
    .from("channel_sessions")
    .select("provider, meta_phone_number_id, status")
    .eq("organization_id", entrada.organizationId)
    .eq("id", sessionId)
    .maybeSingle();
  if (!sessao || sessao.provider !== CHANNEL_PROVIDER_META) return;
  if (estadoDaJanela(sessao.provider, (conversa?.last_inbound_at as string | null) ?? null, new Date()).tipo !== "aberta") {
    return;
  }

  const { data: contato } = await admin
    .from("contacts")
    .select("phone_number, is_blocked")
    .eq("organization_id", entrada.organizationId)
    .eq("id", entrada.contactId)
    .maybeSingle();
  if (!contato?.phone_number || contato.is_blocked) return;

  const to = String(contato.phone_number).replace(/\D/g, "");
  const phoneNumberId = sessao.meta_phone_number_id as string | null;
  if (!to || !phoneNumberId) return;

  let externalId: string | null = null;
  try {
    const enviado = await metaCloudAdapter.send({
      organizationId: entrada.organizationId,
      sessionRef: phoneNumberId,
      to,
      kind: "text",
      body: TEXTO,
    });
    externalId = enviado.externalId;
  } catch (err) {
    logger.warn("confirmacao de saida nao enviada", {
      organization_id: entrada.organizationId,
      to: maskPhone(String(contato.phone_number)),
      detail: err instanceof Error ? redactPhones(err.message).slice(0, 160) : "desconhecido",
    });
    return;
  }
  if (!externalId) return;

  await admin.from("messages").insert({
    organization_id: entrada.organizationId,
    conversation_id: entrada.conversationId,
    channel_session_id: sessionId,
    contact_id: entrada.contactId,
    type: "text",
    direction: "outbound",
    status: "sent",
    body: TEXTO,
    external_id: externalId,
    sent_via: "system",
    metadata: { kind: "opt_out_confirmation" },
  });
}
