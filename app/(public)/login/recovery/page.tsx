import Link from "next/link";
import { headers } from "next/headers";

import { RecoveryForm } from "@/components/auth/RecoveryForm";
import { createClient } from "@/lib/supabase/server";
import { idiomaDaFachada, idiomaDoVisitante } from "@/lib/i18n/idiomas";
import { traduzir } from "@/lib/i18n/dicionario";

export async function generateMetadata() {
  const idioma = idiomaDoVisitante((await headers()).get("accept-language"));
  return { title: traduzir("Recuperar acesso", idioma) };
}

export default async function RecoveryPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
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
        <h1 className="text-2xl font-semibold tracking-tight">{t("Recuperar acesso")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("Use um código de recuperação para reconfigurar sua autenticação em duas etapas.")}
        </p>
      </div>
      <RecoveryForm next={next} />
      <div className="text-center text-sm">
        <Link
          href={next ? `/login?next=${encodeURIComponent(next)}` : "/login"}
          className="text-muted-foreground underline-offset-4 hover:underline"
        >
          {t("Voltar ao login")}
        </Link>
      </div>
    </div>
  );
}
