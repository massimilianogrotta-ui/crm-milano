import { headers } from "next/headers";

import { ResetPasswordForm } from "@/components/auth/ResetPasswordForm";
import { createClient } from "@/lib/supabase/server";
import { idiomaDaFachada, idiomaDoVisitante } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export async function generateMetadata() {
  const idioma = idiomaDoVisitante((await headers()).get("accept-language"));
  return { title: traduzir("Nova senha", idioma) };
}

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const idioma = idiomaDaFachada(
    user?.user_metadata?.locale as string | undefined,
    (await headers()).get("accept-language"),
  );
  const t = (texto: string) => traduzir(texto, idioma);

  return (
    <div className="space-y-6">
      <div className="space-y-1.5 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("Definir nova senha")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Escolha uma nova senha para sua conta")}
        </p>
      </div>
      <ResetPasswordForm />
    </div>
  );
}
