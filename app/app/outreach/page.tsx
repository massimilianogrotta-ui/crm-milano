import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { isOutreachDryRun } from "@/lib/outreach/config";
import { createClient } from "@/lib/supabase/server";
import { OutreachQueue, type RigaCoda } from "./_components/OutreachQueue";

export const dynamic = "force-dynamic";

/**
 * Coda "Da approvare" dell'agente outreach All-io (P0).
 *
 * Il worker cron prepara le bozze; QUI un umano le decide. La pagina è
 * lettura pura — le mutazioni passano dalle server action in
 * `app/actions/outreach/decide.ts`, che sono l'unico punto in cui un
 * approvazione diventa invio (e con `OUTREACH_DRY_RUN` acceso nemmeno quello).
 */
export default async function OutreachPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_proposals")
    .select("id, status, kind, to_address, subject, body, reason, dry_run, created_at, decided_at, error, crm_leads(title)")
    .eq("organization_id", activeOrg.orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  const righe: RigaCoda[] = (data ?? []).map((r) => {
    const lead = (Array.isArray(r.crm_leads) ? r.crm_leads[0] : r.crm_leads) as { title: string | null } | null;
    return { ...r, leadTitle: lead?.title ?? "" } as RigaCoda;
  });

  return (
    <div className="flex h-full flex-col gap-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">{t("Para aprovar")}</h1>
        <p className="text-sm text-muted-foreground">
          {t("O agente prepara os e-mails; nada sai sem a sua aprovação.")}
        </p>
        {isOutreachDryRun() && (
          <p className="mt-2 text-sm font-medium text-amber-600">
            {t("Modo de teste: aprovar não envia nenhum e-mail de verdade.")}
          </p>
        )}
      </header>
      <OutreachQueue righe={righe} />
    </div>
  );
}