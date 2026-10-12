import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { expect, test, type Page } from "@playwright/test";

import { credenciaisSupabaseDeTeste } from "../../scripts/lib/env-de-teste";

const credentials = credenciaisSupabaseDeTeste();
if (process.env.OUTREACH_DRY_RUN === "false") {
  throw new Error("A spec outreach WA exige OUTREACH_DRY_RUN ativo.");
}
const db = createClient(credentials.url, credentials.serviceRole, {
  auth: { persistSession: false },
});

async function insert(table: string, value: Record<string, unknown>): Promise<string> {
  const { data, error } = await db.from(table).insert(value).select("id").single();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data.id as string;
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /entrar/i }).click();
  await page.waitForURL(/\/app(\/|$)/, { timeout: 60_000 });
}

test("bozza WhatsApp: isolamento tra org e approvazione dry-run con nota", async ({ page }) => {
  test.setTimeout(120_000);
  const suffix = randomUUID().slice(0, 8);
  const password = `Local-${randomUUID()}!`;
  const orgs: string[] = [];
  const users: string[] = [];
  const names = [`Outreach A ${suffix}`, `Outreach B ${suffix}`];
  const email = `outreach-${suffix}@invariant.test`;
  const phone = "+393331234567";
  const evidence = ".superpowers/evidence/outreach-wa";

  try {
    const { data: auth, error: authError } = await db.auth.admin.createUser({
      email, password, email_confirm: true,
    });
    if (authError || !auth.user) throw authError ?? new Error("user missing");
    users.push(auth.user.id);

    for (const [index, name] of names.entries()) {
      const org = await insert("organizations", {
        display_name: name, legal_name: name, slug: `outreach-${index}-${suffix}`,
        onboarded_at: new Date().toISOString(),
      });
      orgs.push(org);
      if (index === 0) {
        const { error } = await db.from("user_organizations").insert({
          organization_id: org, user_id: auth.user.id, role: "agent",
          accepted_at: new Date().toISOString(),
        });
        if (error) throw error;
      }
      const pipeline = await insert("crm_pipelines", {
        organization_id: org, name: name, slug: `outreach-${suffix}`,
      });
      const stage = await insert("crm_stages", {
        organization_id: org, pipeline_id: pipeline, name: "A contactar",
        slug: `a-contactar-${suffix}`, position: 1000,
      });
      const contact = await insert("contacts", {
        organization_id: org, name, display_name: name, phone_number: phone,
      });
      const lead = await insert("crm_leads", {
        organization_id: org, pipeline_id: pipeline, stage_id: stage,
        contact_id: contact, title: name, source: "manual", position_in_stage: 1000,
      });
      await insert("outreach_proposals", {
        organization_id: org, lead_id: lead, contact_id: contact,
        channel: "wa", kind: "followup", template_ref: "e2e-local",
        to_address: phone, body: `Ciao ${name}`, reason: "Collaudo locale",
      });
    }

    await login(page, email, password);
    await page.goto("/app/outreach");
    await expect(page.getByText("Modo de teste: aprovar não envia nenhuma mensagem de verdade.")).toBeVisible();
    const own = page.locator("article").filter({ hasText: names[0]! });
    await expect(own.getByText("WhatsApp", { exact: true })).toBeVisible();
    await expect(page.getByText(names[1]!, { exact: true })).toHaveCount(0);
    mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: `${evidence}/pending.png`, fullPage: true });

    await own.getByRole("button", { name: "Aprovar" }).click();
    await expect(page.getByText("Teste", { exact: true })).toBeVisible();
    await page.screenshot({ path: `${evidence}/approved-dry-run.png`, fullPage: true });

    const { data: proposals, error } = await db.from("outreach_proposals")
      .select("id,status,dry_run,provider_message_id")
      .eq("organization_id", orgs[0]);
    if (error) throw error;
    expect(proposals).toHaveLength(1);
    expect(proposals![0]!).toMatchObject({ status: "sent", dry_run: true, provider_message_id: null });
    const { data: notes, error: noteError } = await db.from("crm_lead_activities")
      .select("reason").eq("organization_id", orgs[0])
      .eq("source_module", "outreach").eq("source_id", proposals![0]!.id);
    if (noteError) throw noteError;
    expect(notes).toHaveLength(1);
    expect(notes![0]!.reason).toContain("nessun invio reale");
  } finally {
    for (const org of orgs) {
      const { error } = await db.from("organizations").delete().eq("id", org);
      if (error) throw error;
    }
    for (const user of users) await db.auth.admin.deleteUser(user);
  }
});
