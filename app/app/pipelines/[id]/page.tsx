import { notFound, redirect } from "next/navigation";
import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { createClient } from "@/lib/supabase/server";
import { moedaServidaOu } from "@/lib/money";
import { PipelinePageClient } from "./_client";

export const dynamic = "force-dynamic";

export default async function PipelinePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");

  const { id } = await params;
  const supabase = await createClient();
  // Mesma razão da Agenda: a RLS é piso, não escopo. Sem este filtro o funil de
  // OUTRA organização do mesmo usuário abre, e o quadro monta com as etapas de
  // um lugar e o cabeçalho de outro.
  const { data: pipeline } = await supabase
    .from("crm_pipelines")
    .select("id, name, vocabulary")
    .eq("organization_id", activeOrg.orgId)
    .eq("id", id)
    .maybeSingle();
  if (!pipeline) notFound();
  // A moeda que a organização declarou (`organizations.currency`, migration
  // 0208) — sem isto, o formulário de novo lead grava tudo em BRL, mesmo numa
  // instalação em EUR. `moedaServidaOu` cai no padrão se a linha não trouxer
  // nada válido (mesma doutrina de `lib/catalogo/moeda-da-org.ts`).
  const { data: org } = await supabase
    .from("organizations")
    .select("currency")
    .eq("id", activeOrg.orgId)
    .maybeSingle();
  const currency = moedaServidaOu(org?.currency);
  return <PipelinePageClient pipelineId={id} initialName={pipeline.name} currency={currency} />;
}
