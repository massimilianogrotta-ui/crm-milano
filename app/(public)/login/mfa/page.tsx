import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";
import { MfaForm } from "@/components/auth/MfaForm";
import { idiomaDaFachada, idiomaDoVisitante } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export async function generateMetadata() {
  const idioma = idiomaDoVisitante((await headers()).get("accept-language"));
  return { title: traduzir("Verificação em duas etapas", idioma) };
}

export default async function MfaChallengePage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: factorsData } = await supabase.auth.mfa.listFactors();
  const hasVerified = !!factorsData?.totp?.some((f) => f.status === "verified");
  if (!hasVerified) redirect("/app");

  const idioma = idiomaDaFachada(
    user.user_metadata?.locale as string | undefined,
    (await headers()).get("accept-language"),
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Verificação em duas etapas")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Digite o código de 6 dígitos do seu autenticador.")}
        </p>
      </div>
      <MfaForm next={next} />
    </div>
  );
}
