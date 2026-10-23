/**
 * País que a organização assume quando um telefone chega sem DDI.
 *
 * Mora em `organizations.settings.phone_default_country`. Ausência, valor
 * desconhecido e falha de leitura valem Brasil: é o que toda instalação já
 * fazia, e um default novo reescreveria a planilha de quem já importa.
 * Equador é escolha explícita da organização — nenhuma org é cravada no código.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type PaisTelefone = "BR" | "EC";

export function paisPadraoDoTelefone(settings: unknown): PaisTelefone {
  if (!settings || typeof settings !== "object") return "BR";
  const valor = (settings as { phone_default_country?: unknown }).phone_default_country;
  return valor === "EC" ? "EC" : "BR";
}

/**
 * Nunca lança. Captura de lead e importação não podem morrer porque a
 * configuração da organização não voltou — o pior desfecho ali é recusar o
 * telefone, e o default BR é o comportamento anterior.
 */
export async function paisDaOrganizacao(
  db: SupabaseClient,
  organizationId: string,
): Promise<PaisTelefone> {
  try {
    const { data, error } = await db
      .from("organizations")
      .select("settings")
      .eq("id", organizationId)
      .maybeSingle();
    if (error) return "BR";
    return paisPadraoDoTelefone(data?.settings);
  } catch {
    return "BR";
  }
}
