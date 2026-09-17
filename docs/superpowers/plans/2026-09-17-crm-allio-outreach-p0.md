# Agente outreach CRM All-io · P0 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un worker cron prepara bozze email (modelli fissi, niente LLM) per i lead della pipeline `milano-prospect` dell'org vendite All-io, le mette in una coda "Da approvare", e solo dopo approvazione umana le invia via Resend (o le registra soltanto, in modalità dry-run), sposta il lead a "In attesa" e scrive la timeline.

**Architecture:** Nuova tabella `outreach_proposals` (org-scoped, RLS a ruoli). Logica pura in `lib/outreach/` (modelli, selezione candidati, esecuzione con dipendenze iniettate) testata con vitest. Una rotta cron `app/api/v1/cron/outreach-proposals` (admin client, org fissata da env) genera le proposte. Una pagina `/app/outreach` con server actions approva/modifica/rifiuta. Interruttore `OUTREACH_DRY_RUN` (default: acceso) blocca ogni invio reale.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase Postgres + RLS, Resend (`lib/email/resend.ts`), vitest, shadcn/ui, i18n a chiavi portoghesi (`lib/i18n/dicionario.ts`).

**Fonti:** spec `/Users/Max/DEF/CRM-ALLIO-AGENT-SPEC.md` · handshake `/Users/Max/DEF/Planning/_active/crm-allio-agent/handshake_crm-allio-agent.md`.

---

## Regole per chi esegue (leggere prima)

1. Leggi `CLAUDE.md` e `AGENTS.md` del repo prima di tutto.
2. Lavora su branch `feat/outreach-p0` in un worktree sotto `~/Dev/worktrees/` (regola progetti di Max). **Mai push, merge o deploy senza ok esplicito di Max.**
3. **Task 1 (migrazione SQL + RLS) NON va delegato a modelli economici né a Codex**: lo scrive e lo rivede il modello forte.
4. Il modulo `lib/outreach/` non deve MAI essere importato da `lib/agent-engine/` o `lib/ai/` (l'LLM non deve poter inviare). Task 9 lo rende un test.
5. Non passare dalle automazioni/follow-up esistenti (`lib/automation/`, `lib/followup/`): inviano senza approvazione.
6. Stringhe UI: la chiave è il testo in pt-BR, con traduzioni `it`, `es`, `en` nel dizionario (un test CI pretende almeno `es`).

## File structure

| File | Responsabilità |
|---|---|
| `supabase/migrations/20260917090000_0238_outreach_proposals.sql` | tabella coda + RLS |
| `supabase/baseline.sql` (append) | stesso schema, idempotente, per self-host |
| `supabase/migrations/MANIFEST.md` (append) | riga 0238 |
| `lib/env.ts` (modify) | `OUTREACH_DRY_RUN`, `OUTREACH_ORG_ID` |
| `lib/outreach/templates.ts` | segmento del lead + rendering dei 3 modelli |
| `lib/outreach/select.ts` | regole pure: chi riceve cosa (cap, dedup, bloccati) |
| `lib/outreach/generate.ts` | legge DB (admin, org filtrata) e inserisce proposte |
| `lib/outreach/execute.ts` | approva/rifiuta con dipendenze iniettate |
| `lib/outreach/move-to-waiting.ts` | sposta il lead Da contattare → In attesa + timeline |
| `app/api/v1/cron/outreach-proposals/route.ts` | rotta cron |
| `docker/scheduler/entrypoint.sh` (modify) | pianificazione 4 volte al giorno |
| `app/actions/outreach/decide.ts` | server actions approva/rifiuta/modifica |
| `app/app/outreach/page.tsx` + `_components/OutreachQueue.tsx` | pagina "Da approvare" |
| `lib/navigation/catalogo.ts` (modify) | voce di navigazione |
| `lib/i18n/dicionario.ts` (modify) | stringhe |
| `tests/unit/outreach-*.test.ts` | test |
| `prompts/out/CRM-ALLIO-AGENT-P0.md` | report finale |

---

### Task 1: Tabella `outreach_proposals` (modello forte, niente delega)

**Files:**
- Create: `supabase/migrations/20260917090000_0238_outreach_proposals.sql`
- Modify: `supabase/baseline.sql` (append in fondo)
- Modify: `supabase/migrations/MANIFEST.md` (append riga)

- [ ] **Step 1: Verifica il numero libero**

Run: `ls supabase/migrations | sort | tail -3 && grep -c "0238" supabase/migrations/MANIFEST.md`
Expected: ultima migrazione `..._0237_...`, conteggio `0`. Se 0238 è già preso, usa il primo numero libero e aggiorna tutti i riferimenti di questo task.

- [ ] **Step 2: Scrivi la migrazione**

```sql
-- 0238 · outreach_proposals
-- Coda "Da approvare" dell'agente outreach All-io (P0). Il worker scrive
-- proposte `pending`; SOLO un umano (ruolo agent in su) le decide. Nessuna
-- riga di questa tabella provoca invii da sola: l'invio lo fa la server action
-- dopo l'approvazione, e con OUTREACH_DRY_RUN acceso non invia nulla.

create table if not exists public.outreach_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  lead_id uuid not null references public.crm_leads(id) on delete cascade,
  contact_id uuid references public.contacts(id) on delete set null,
  channel text not null default 'email' check (channel in ('email', 'wa')),
  kind text not null check (kind in ('first_contact', 'followup')),
  template_ref text not null,
  to_address text not null,
  subject text,
  body text not null,
  reason text not null,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'sent', 'failed')),
  dry_run boolean not null default true,
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  sent_at timestamptz,
  provider_message_id text,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_outreach_proposals_org_status
  on public.outreach_proposals(organization_id, status, created_at desc);
create index if not exists idx_outreach_proposals_lead
  on public.outreach_proposals(lead_id, channel, created_at desc);
-- Una sola proposta aperta per lead+canale.
create unique index if not exists uniq_outreach_proposals_pending
  on public.outreach_proposals(lead_id, channel) where status = 'pending';

alter table public.outreach_proposals enable row level security;

drop policy if exists outreach_proposals_select on public.outreach_proposals;
drop policy if exists outreach_proposals_write on public.outreach_proposals;

create policy outreach_proposals_select on public.outreach_proposals for select
  using (organization_id in (select public.fn_user_org_ids()));

-- Scrive solo chi può rispondere ai clienti (agent in su): un viewer vede la
-- coda ma non approva. Stessa forma di voice_calls (0235).
create policy outreach_proposals_write on public.outreach_proposals for all
  using (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  )
  with check (
    organization_id in (select public.fn_user_org_ids())
    and public.fn_role_at_least(organization_id, 'agent')
  );

revoke all on public.outreach_proposals from anon;

drop trigger if exists trg_outreach_proposals_set_updated_at on public.outreach_proposals;
create trigger trg_outreach_proposals_set_updated_at
  before update on public.outreach_proposals
  for each row execute function public.fn_set_updated_at();
```

- [ ] **Step 3: Appendi lo stesso blocco al baseline**

In fondo a `supabase/baseline.sql` aggiungi un blocco etichettato con la convenzione del file:

```sql
-- ---- outreach_proposals (migration 0238) ----
```
seguito dall'intero SQL dello Step 2 (è già tutto idempotente: `if not exists`, `drop ... if exists`). Controlla la forma degli ultimi blocchi del baseline (`tail -60 supabase/baseline.sql`) e allinea commenti/etichette.

- [ ] **Step 4: Appendi la riga al MANIFEST**

```markdown
| `20260917090000` | `0238_outreach_proposals` | Coda "Da approvare" dell'agente outreach All-io (P0). Tabella org-scoped: il worker propone, un umano con ruolo `agent` in su decide. Lettura per tutta l'org, scrittura a ruoli (forma 0235). Unique parziale: una sola proposta `pending` per lead+canale. Nessun invio parte dalla tabella. Baseline INSTALL/UPDATE idempotente. |
```

- [ ] **Step 5: Verifica con il DB effimero**

Run: `pnpm test:db`
Expected: PASS (install + update due volte + invarianti). Se fallisce `rbac-config-ia-canais` o `apendice-do-baseline-nao-diverge-da-cadeia`, leggi il messaggio e allinea la forma, non disattivare il test.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260917090000_0238_outreach_proposals.sql supabase/baseline.sql supabase/migrations/MANIFEST.md
git commit -m "feat(outreach): tabella outreach_proposals con RLS a ruoli (0238)"
```

---

### Task 2: Variabili d'ambiente

**Files:**
- Modify: `lib/env.ts` (vicino a `RESEND_FROM_EMAIL`, riga ~260)
- Modify: `.env.example`, `.env.hostgator.example`
- Test: `tests/unit/outreach-env.test.ts`

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, expect, it } from "vitest";

import { outreachDryRun } from "@/lib/outreach/config";

describe("outreachDryRun", () => {
  it("è acceso se la variabile manca", () => {
    expect(outreachDryRun(undefined)).toBe(true);
    expect(outreachDryRun("")).toBe(true);
  });
  it("si spegne SOLO con la stringa esatta 'false'", () => {
    expect(outreachDryRun("false")).toBe(false);
    expect(outreachDryRun("FALSE")).toBe(true);
    expect(outreachDryRun("0")).toBe(true);
    expect(outreachDryRun("no")).toBe(true);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/outreach-env.test.ts` → FAIL (modulo mancante).

- [ ] **Step 3: Implementa `lib/outreach/config.ts`**

```ts
import { env } from "@/lib/env";

/**
 * Interruttore di sicurezza: qualsiasi valore diverso da "false" esatto
 * significa "non inviare davvero". Sbagliare a scrivere non deve mai
 * trasformarsi in email vere.
 */
export function outreachDryRun(raw: string | undefined): boolean {
  return raw !== "false";
}

export function isOutreachDryRun(): boolean {
  return outreachDryRun(env.OUTREACH_DRY_RUN);
}

export function outreachOrgId(): string | null {
  const id = env.OUTREACH_ORG_ID.trim();
  return id.length > 0 ? id : null;
}

export const OUTREACH_PIPELINE_SLUG = "milano-prospect";
export const STAGE_DA_CONTATTARE = "da-contattare";
export const STAGE_IN_ATTESA = "in-attesa";
export const MAX_PROPOSTE_PER_GIRO = 20;
export const GIORNI_DEDUP = 7;
export const GIORNI_PRIMA_DEL_RICONTATTO = 7;
```

E in `lib/env.ts`, dentro lo schema accanto a `RESEND_FROM_EMAIL`:

```ts
  /** Agente outreach All-io: qualsiasi valore ≠ "false" = nessun invio reale. */
  OUTREACH_DRY_RUN: z.string().optional(),
  /** Org su cui gira il worker outreach. Vuota = worker spento. */
  OUTREACH_ORG_ID: z.string().optional().default(""),
```

Nei due `.env*.example` aggiungi:

```
# Agente outreach (P0). Lascia DRY_RUN vuoto finché Max non dà l'ok agli invii veri.
OUTREACH_DRY_RUN=
OUTREACH_ORG_ID=
```

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/outreach-env.test.ts && pnpm typecheck` → PASS.

- [ ] **Step 5: Commit** `git add lib/env.ts lib/outreach/config.ts tests/unit/outreach-env.test.ts .env.example .env.hostgator.example && git commit -m "feat(outreach): interruttore dry-run e org del worker"`

---

### Task 3: Modelli di testo

Testi presi da `~/Documents/Lavoro/BusinessDev-Milano/email-anteprima-*.html` e `exports/PLAYBOOK-OUTREACH-MILANO.md`. **Modifica rispetto all'originale:** tolta la frase "Ho notato che il vostro studio non ha ancora una presenza online propria", perché non è verificata lead per lead. Max rivede i testi prima degli invii veri (vedi Task 10).

**Files:**
- Create: `lib/outreach/templates.ts`
- Test: `tests/unit/outreach-templates.test.ts`

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, expect, it } from "vitest";

import { renderOutreach, segmentoDelLead } from "@/lib/outreach/templates";

describe("segmentoDelLead", () => {
  it("riconosce i dentisti da titolo o tag", () => {
    expect(segmentoDelLead({ title: "Studio Dentistico Bianchi", tags: [] })).toBe("dentista");
    expect(segmentoDelLead({ title: "Rossi", tags: ["odontoiatria"] })).toBe("dentista");
  });
  it("riconosce l'estetica", () => {
    expect(segmentoDelLead({ title: "Clinica Estetica Aurora", tags: [] })).toBe("estetica");
    expect(segmentoDelLead({ title: "Aurora", tags: ["centro estetico"] })).toBe("estetica");
  });
  it("altrimenti generico", () => {
    expect(segmentoDelLead({ title: "Aurora srl", tags: [] })).toBe("generico");
  });
});

describe("renderOutreach", () => {
  it("mette il nome dello studio e il footer STOP", () => {
    const r = renderOutreach({ kind: "first_contact", segmento: "dentista", nomeStudio: "Studio Bianchi" });
    expect(r.templateRef).toBe("first_contact.dentista.v1");
    expect(r.subject).toContain("Demo 10 min");
    expect(r.body).toContain("«Studio Bianchi»");
    expect(r.body).toContain("STOP");
    expect(r.body).toContain("https://demo-mini.all-io.com");
  });
  it("non contiene mai prezzi", () => {
    for (const kind of ["first_contact", "followup"] as const) {
      for (const segmento of ["dentista", "estetica", "generico"] as const) {
        const r = renderOutreach({ kind, segmento, nomeStudio: "X" });
        expect(r.body).not.toMatch(/€|\beuro\b|\d+\s*,\d{2}/i);
      }
    }
  });
  it("ripulisce il nome da caratteri pericolosi", () => {
    const r = renderOutreach({ kind: "first_contact", segmento: "generico", nomeStudio: "A<script>\r\nB" });
    expect(r.body).not.toContain("<script>");
    expect(r.body).not.toContain("\r");
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/outreach-templates.test.ts` → FAIL.

- [ ] **Step 3: Implementa**

```ts
export type Segmento = "dentista" | "estetica" | "generico";
export type OutreachKind = "first_contact" | "followup";

export function segmentoDelLead(lead: { title: string | null; tags: string[] | null }): Segmento {
  const testo = [lead.title ?? "", ...(lead.tags ?? [])].join(" ").toLowerCase();
  if (/dent|odont|ortodon/.test(testo)) return "dentista";
  if (/estetic|beauty|bellezza/.test(testo)) return "estetica";
  return "generico";
}

const CTA_DEMO = "https://demo-mini.all-io.com";
const CTA_WA = "https://wa.me/393780699002";

const CHI: Record<Segmento, { aiuto: string; pazienti: string; luogo: string }> = {
  dentista: { aiuto: "studi dentali", pazienti: "pazienti", luogo: "dello studio" },
  estetica: { aiuto: "cliniche e centri estetici", pazienti: "clienti", luogo: "del centro" },
  generico: { aiuto: "studi e centri di Milano", pazienti: "clienti", luogo: "della struttura" },
};

function pulisci(nome: string): string {
  return nome.replace(/[<>"\r\n]/g, "").trim().slice(0, 120);
}

function footer(nomeStudio: string, luogo: string): string {
  return [
    "— Max · All-io · Milano",
    "",
    `Ricevi questa email come titolare/responsabile ${luogo} «${nomeStudio}».`,
    'Non vuoi più riceverle? Rispondi con "STOP".',
  ].join("\n");
}

export function renderOutreach(input: {
  kind: OutreachKind;
  segmento: Segmento;
  nomeStudio: string;
}): { templateRef: string; subject: string; body: string } {
  const nome = pulisci(input.nomeStudio);
  const c = CHI[input.segmento];
  const templateRef = `${input.kind}.${input.segmento}.v1`;

  if (input.kind === "first_contact") {
    return {
      templateRef,
      subject: `Demo 10 min — agenda e ritorni ${c.pazienti} (senza cambiare gestionale)`,
      body: [
        "Buongiorno,",
        `sono Max di All-io: aiuto ${c.aiuto} a ridurre i buchi in agenda e i mancati ritorni dei ${c.pazienti}.`,
        "",
        "In concreto, senza cambiare il vostro gestionale:",
        "promemoria, richiami e prenotazioni su WhatsApp, installati da me in un giorno.",
        "Voi non toccate nulla. Costo fisso mensile, niente canoni nascosti.",
        "",
        `Le va di vedere una demo di 10 minuti questa settimana? Può provarla qui: ${CTA_DEMO}`,
        `oppure scrivermi su WhatsApp: ${CTA_WA}`,
        "",
        footer(nome, c.luogo),
      ].join("\n"),
    };
  }

  return {
    templateRef,
    subject: "Re: demo 10 min All-io",
    body: [
      "Buongiorno,",
      `le avevo scritto la settimana scorsa per una demo di 10 minuti su agenda e ritorni dei ${c.pazienti}.`,
      "Se non è il momento nessun problema: mi basta un sì o un no.",
      "",
      `Demo: ${CTA_DEMO} · WhatsApp: ${CTA_WA}`,
      "",
      footer(nome, c.luogo),
    ].join("\n"),
  };
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/outreach-templates.test.ts` → PASS.

- [ ] **Step 5: Commit** `git add lib/outreach/templates.ts tests/unit/outreach-templates.test.ts && git commit -m "feat(outreach): modelli email fissi per dentisti, estetica e generico"`

---

### Task 4: Regole di selezione (pure)

**Files:**
- Create: `lib/outreach/select.ts`
- Test: `tests/unit/outreach-select.test.ts`

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, expect, it } from "vitest";

import { scegliProposte, type Candidato, type StoricoProposta } from "@/lib/outreach/select";

const ORA = new Date("2026-09-20T10:00:00Z");
const giorniFa = (n: number) => new Date(ORA.getTime() - n * 86_400_000).toISOString();

function cand(over: Partial<Candidato> = {}): Candidato {
  return {
    leadId: over.leadId ?? "l1",
    contactId: "c1",
    title: "Studio Dentistico Bianchi",
    tags: [],
    email: "info@bianchi.it",
    isBlocked: false,
    stageSlug: "da-contattare",
    ...over,
  };
}

describe("scegliProposte", () => {
  it("primo contatto per un lead in Da contattare con email", () => {
    const r = scegliProposte([cand()], [], ORA);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ leadId: "l1", kind: "first_contact", toAddress: "info@bianchi.it" });
  });
  it("salta bloccati e senza email", () => {
    const r = scegliProposte([cand({ isBlocked: true }), cand({ leadId: "l2", email: null })], [], ORA);
    expect(r).toHaveLength(0);
  });
  it("salta chi ha già una proposta negli ultimi 7 giorni, di qualunque stato", () => {
    const storico: StoricoProposta[] = [
      { leadId: "l1", kind: "first_contact", status: "rejected", createdAt: giorniFa(3), sentAt: null },
    ];
    expect(scegliProposte([cand()], storico, ORA)).toHaveLength(0);
  });
  it("salta chi ha già ricevuto il primo contatto anche se vecchio", () => {
    const storico: StoricoProposta[] = [
      { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(30), sentAt: giorniFa(30) },
    ];
    expect(scegliProposte([cand()], storico, ORA)).toHaveLength(0);
  });
  it("ricontatto: In attesa, primo contatto inviato da ≥7 giorni, nessun ricontatto prima", () => {
    const c = cand({ stageSlug: "in-attesa" });
    const inviato: StoricoProposta = { leadId: "l1", kind: "first_contact", status: "sent", createdAt: giorniFa(9), sentAt: giorniFa(8) };
    expect(scegliProposte([c], [inviato], ORA)[0]).toMatchObject({ kind: "followup" });
    const giaRicontattato: StoricoProposta = { leadId: "l1", kind: "followup", status: "rejected", createdAt: giorniFa(8), sentAt: null };
    expect(scegliProposte([c], [inviato, giaRicontattato], ORA)).toHaveLength(0);
    const troppoPresto: StoricoProposta = { ...inviato, createdAt: giorniFa(5), sentAt: giorniFa(5) };
    expect(scegliProposte([c], [troppoPresto], ORA)).toHaveLength(0);
  });
  it("mai più di 20 per giro", () => {
    const tanti = Array.from({ length: 50 }, (_, i) => cand({ leadId: `l${i}` }));
    expect(scegliProposte(tanti, [], ORA)).toHaveLength(20);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/outreach-select.test.ts` → FAIL.

- [ ] **Step 3: Implementa**

```ts
import {
  GIORNI_DEDUP,
  GIORNI_PRIMA_DEL_RICONTATTO,
  MAX_PROPOSTE_PER_GIRO,
  STAGE_DA_CONTATTARE,
  STAGE_IN_ATTESA,
} from "@/lib/outreach/config";
import { renderOutreach, segmentoDelLead, type OutreachKind } from "@/lib/outreach/templates";

export interface Candidato {
  leadId: string;
  contactId: string | null;
  title: string | null;
  tags: string[] | null;
  email: string | null;
  isBlocked: boolean;
  stageSlug: string;
}

export interface StoricoProposta {
  leadId: string;
  kind: OutreachKind;
  status: "pending" | "approved" | "rejected" | "sent" | "failed";
  createdAt: string;
  sentAt: string | null;
}

export interface NuovaProposta {
  leadId: string;
  contactId: string | null;
  kind: OutreachKind;
  templateRef: string;
  toAddress: string;
  subject: string;
  body: string;
  reason: string;
}

const GIORNO_MS = 86_400_000;

export function scegliProposte(
  candidati: Candidato[],
  storico: StoricoProposta[],
  ora: Date,
): NuovaProposta[] {
  const perLead = new Map<string, StoricoProposta[]>();
  for (const s of storico) {
    const lista = perLead.get(s.leadId) ?? [];
    lista.push(s);
    perLead.set(s.leadId, lista);
  }

  const out: NuovaProposta[] = [];
  for (const c of candidati) {
    if (out.length >= MAX_PROPOSTE_PER_GIRO) break;
    if (c.isBlocked || !c.email) continue;

    const mie = perLead.get(c.leadId) ?? [];
    const recente = mie.some((s) => ora.getTime() - Date.parse(s.createdAt) < GIORNI_DEDUP * GIORNO_MS);
    if (recente) continue;

    let kind: OutreachKind | null = null;
    let reason = "";
    if (c.stageSlug === STAGE_DA_CONTATTARE && !mie.some((s) => s.kind === "first_contact")) {
      kind = "first_contact";
      reason = "Lead in «Da contattare» mai contattato";
    } else if (c.stageSlug === STAGE_IN_ATTESA && !mie.some((s) => s.kind === "followup")) {
      const inviato = mie.find((s) => s.kind === "first_contact" && s.status === "sent" && s.sentAt);
      if (inviato && ora.getTime() - Date.parse(inviato.sentAt!) >= GIORNI_PRIMA_DEL_RICONTATTO * GIORNO_MS) {
        kind = "followup";
        reason = `Nessuna risposta ${GIORNI_PRIMA_DEL_RICONTATTO}+ giorni dopo il primo contatto`;
      }
    }
    if (!kind) continue;

    const segmento = segmentoDelLead(c);
    const r = renderOutreach({ kind, segmento, nomeStudio: c.title ?? "" });
    out.push({
      leadId: c.leadId,
      contactId: c.contactId,
      kind,
      templateRef: r.templateRef,
      toAddress: c.email,
      subject: r.subject,
      body: r.body,
      reason: `${reason} · segmento ${segmento}`,
    });
  }
  return out;
}
```

Nota: un ricontatto "inviato" in dry-run ha `status = 'sent'` e `dry_run = true`; conta come inviato, così il flusso si prova per intero in modalità prova.

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/outreach-select.test.ts` → PASS.

- [ ] **Step 5: Commit** `git add lib/outreach/select.ts tests/unit/outreach-select.test.ts && git commit -m "feat(outreach): regole pure di selezione (cap 20, dedup 7gg, bloccati, ricontatto)"`

---

### Task 5: Generatore + rotta cron

**Files:**
- Create: `lib/outreach/generate.ts`
- Create: `app/api/v1/cron/outreach-proposals/route.ts`
- Modify: `docker/scheduler/entrypoint.sh` (tabella `CRONS=`)

- [ ] **Step 1: Implementa `lib/outreach/generate.ts`**

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { logger } from "@/lib/logger";
import { isOutreachDryRun, OUTREACH_PIPELINE_SLUG, STAGE_DA_CONTATTARE, STAGE_IN_ATTESA } from "@/lib/outreach/config";
import { scegliProposte, type Candidato, type StoricoProposta } from "@/lib/outreach/select";

export interface EsitoGenerazione {
  stato: "ok" | "pipeline_assente" | "errore";
  candidati: number;
  create: number;
  errore?: string;
}

/** Usa l'admin client: OGNI query filtra organization_id a mano (regola di lib/supabase/admin.ts). */
export async function generaProposte(admin: SupabaseClient, orgId: string, ora = new Date()): Promise<EsitoGenerazione> {
  const { data: pipeline, error: ePipe } = await admin
    .from("crm_pipelines")
    .select("id")
    .eq("organization_id", orgId)
    .eq("slug", OUTREACH_PIPELINE_SLUG)
    .maybeSingle();
  if (ePipe) return { stato: "errore", candidati: 0, create: 0, errore: ePipe.message };
  if (!pipeline) return { stato: "pipeline_assente", candidati: 0, create: 0 };

  const { data: stages, error: eStages } = await admin
    .from("crm_stages")
    .select("id, slug")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id)
    .in("slug", [STAGE_DA_CONTATTARE, STAGE_IN_ATTESA]);
  if (eStages) return { stato: "errore", candidati: 0, create: 0, errore: eStages.message };
  const slugPerId = new Map((stages ?? []).map((s) => [s.id as string, s.slug as string]));
  if (slugPerId.size === 0) return { stato: "pipeline_assente", candidati: 0, create: 0 };

  const { data: leads, error: eLeads } = await admin
    .from("crm_leads")
    .select("id, title, tags, stage_id, contact_id, contacts(email, is_blocked)")
    .eq("organization_id", orgId)
    .eq("pipeline_id", pipeline.id)
    .eq("status", "open")
    .in("stage_id", [...slugPerId.keys()])
    .order("created_at", { ascending: true })
    .limit(500);
  if (eLeads) return { stato: "errore", candidati: 0, create: 0, errore: eLeads.message };

  const candidati: Candidato[] = (leads ?? []).map((l) => {
    const contatto = (Array.isArray(l.contacts) ? l.contacts[0] : l.contacts) as
      | { email: string | null; is_blocked: boolean }
      | null;
    return {
      leadId: l.id as string,
      contactId: (l.contact_id as string | null) ?? null,
      title: (l.title as string | null) ?? null,
      tags: (l.tags as string[] | null) ?? [],
      email: contatto?.email ?? null,
      // Senza contatto non sappiamo se è bloccato: trattalo come bloccato.
      isBlocked: contatto ? contatto.is_blocked : true,
      stageSlug: slugPerId.get(l.stage_id as string) ?? "",
    };
  });

  const { data: storicoRows, error: eStorico } = await admin
    .from("outreach_proposals")
    .select("lead_id, kind, status, created_at, sent_at")
    .eq("organization_id", orgId)
    .eq("channel", "email")
    .in("lead_id", candidati.map((c) => c.leadId));
  if (eStorico) return { stato: "errore", candidati: candidati.length, create: 0, errore: eStorico.message };
  const storico: StoricoProposta[] = (storicoRows ?? []).map((s) => ({
    leadId: s.lead_id as string,
    kind: s.kind as StoricoProposta["kind"],
    status: s.status as StoricoProposta["status"],
    createdAt: s.created_at as string,
    sentAt: (s.sent_at as string | null) ?? null,
  }));

  const nuove = scegliProposte(candidati, storico, ora);
  if (nuove.length === 0) return { stato: "ok", candidati: candidati.length, create: 0 };

  const { data: inserite, error: eIns } = await admin
    .from("outreach_proposals")
    .upsert(
      nuove.map((n) => ({
        organization_id: orgId,
        lead_id: n.leadId,
        contact_id: n.contactId,
        channel: "email",
        kind: n.kind,
        template_ref: n.templateRef,
        to_address: n.toAddress,
        subject: n.subject,
        body: n.body,
        reason: n.reason,
        status: "pending",
        dry_run: isOutreachDryRun(),
      })),
      { onConflict: "lead_id,channel", ignoreDuplicates: true },
    )
    .select("id");
  if (eIns) {
    logger.warn("[outreach] insert proposte fallito", { organization_id: orgId, error: eIns.message });
    return { stato: "errore", candidati: candidati.length, create: 0, errore: eIns.message };
  }
  return { stato: "ok", candidati: candidati.length, create: (inserite ?? []).length };
}
```

Nota per chi esegue: `onConflict` con un indice unico **parziale** può non essere accettato da PostgREST. Se `pnpm test:db`/prova locale dà errore `there is no unique or exclusion constraint matching`, sostituisci `upsert(...)` con `insert(...)` riga per riga e ignora l'errore con codice `23505` (duplicato), contando solo le righe inserite.

- [ ] **Step 2: Implementa la rotta**

```ts
/**
 * GET /api/v1/cron/outreach-proposals
 *
 * Agente outreach All-io (P0): prepara bozze email nella coda "Da approvare".
 * NON invia nulla. Org fissata da OUTREACH_ORG_ID (vuota = spento).
 * Auth: `Authorization: Bearer <INTERNAL_CRON_SECRET>` (fail-closed).
 */
import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";

import { ok, fail } from "@/lib/api/wrappers";
import { env } from "@/lib/env";
import { outreachOrgId } from "@/lib/outreach/config";
import { generaProposte } from "@/lib/outreach/generate";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<Response> {
  const requestId = randomUUID();

  const auth = req.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : "";
  const accepted: string[] = [];
  if (env.INTERNAL_CRON_SECRET) accepted.push(env.INTERNAL_CRON_SECRET);
  if (env.INTERNAL_SECRET) accepted.push(env.INTERNAL_SECRET);
  if (accepted.length === 0 || !provided || !accepted.includes(provided)) {
    return fail("forbidden", "Cron secret missing or invalid.", 403, { requestId });
  }

  const orgId = outreachOrgId();
  if (!orgId) return ok({ stato: "spento" }, { requestId });

  // Fascia oraria Italia: solo tra le 9 e le 19.
  const ora = Number(
    new Intl.DateTimeFormat("it-IT", { hour: "2-digit", hour12: false, timeZone: "Europe/Rome" }).format(new Date()),
  );
  if (ora < 9 || ora >= 19) return ok({ stato: "fuori_orario" }, { requestId });

  const esito = await generaProposte(createAdminClient(), orgId);
  return ok(esito, { requestId });
}
```

- [ ] **Step 3: Pianifica nel scheduler**

In `docker/scheduler/entrypoint.sh`, dentro `CRONS=` (prima di `"` finale), aggiungi. L'orario del container scheduler è da verificare: se il container gira in UTC (controlla `TZ` in `docker-compose.prod.yml`), 9:30/12:30/16:30/18:30 Italia (ora legale) = 7:30/10:30/14:30/16:30 UTC; la rotta comunque rifiuta fuori dalle 9-19 Italia.

```
30 7,10,14,16 * * *|60|api/v1/cron/outreach-proposals
```

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/cron-routes-scheduled.test.ts && pnpm typecheck` → PASS. Se il test richiede anche altri file (legge il suo header), aggiorna quelli che indica.

- [ ] **Step 5: Commit** `git add lib/outreach/generate.ts app/api/v1/cron/outreach-proposals docker/scheduler/entrypoint.sh && git commit -m "feat(outreach): worker cron che prepara la coda Da approvare"`

---

### Task 6: Spostamento a "In attesa" + timeline

**Files:**
- Create: `lib/outreach/move-to-waiting.ts`

- [ ] **Step 1: Implementa** (stessa forma di `lib/leads/handoff-stage-move.ts`, con trava ottimista)

```ts
import type { SupabaseClient } from "@supabase/supabase-js";

import { emitLeadActivity, stageChangeReason } from "@/lib/leads/activity-emitter";
import { logger } from "@/lib/logger";
import { STAGE_DA_CONTATTARE, STAGE_IN_ATTESA } from "@/lib/outreach/config";

/**
 * Dopo un primo contatto approvato: Da contattare → In attesa.
 * Se un umano ha già spostato il lead, non tocca nulla.
 * `userId` = chi ha approvato (finisce in timeline).
 */
export async function spostaInAttesa(
  supabase: SupabaseClient,
  input: { organizationId: string; leadId: string; contactId: string | null; userId: string },
): Promise<"movido" | "non_in_da_contattare" | "errore"> {
  const { data: lead } = await supabase
    .from("crm_leads")
    .select("id, pipeline_id, stage_id")
    .eq("id", input.leadId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  if (!lead) return "errore";

  const { data: stages } = await supabase
    .from("crm_stages")
    .select("id, slug, name")
    .eq("pipeline_id", lead.pipeline_id)
    .in("slug", [STAGE_DA_CONTATTARE, STAGE_IN_ATTESA]);
  const da = stages?.find((s) => s.slug === STAGE_DA_CONTATTARE);
  const a = stages?.find((s) => s.slug === STAGE_IN_ATTESA);
  if (!da || !a || lead.stage_id !== da.id) return "non_in_da_contattare";

  const { data: aggiornate, error } = await supabase
    .from("crm_leads")
    .update({ stage_id: a.id })
    .eq("id", lead.id)
    .eq("stage_id", da.id)
    .select("id");
  if (error) {
    logger.warn("[outreach] update stage fallito", { lead_id: lead.id, error: error.message });
    return "errore";
  }
  if ((aggiornate ?? []).length === 0) return "non_in_da_contattare";

  await emitLeadActivity(supabase, {
    organizationId: input.organizationId,
    leadId: lead.id,
    contactId: input.contactId,
    type: "stage_changed",
    sourceModule: "outreach",
    sourceId: lead.id,
    actor: { type: "user", id: input.userId },
    reason: stageChangeReason(da.name as string, a.name as string),
    payload: { de: da.id, para: a.id },
  });
  return "movido";
}
```

Nota: `handoff-stage-move.ts` emette anche l'evento `lead.stage_changed` via `rpc("emit_event")`. **Qui NON lo emettiamo in P0**: quell'evento può far partire automazioni/follow-up che inviano senza approvazione. Se i test di invariante pretendono l'evento per ogni cambio di stage, fermati e chiedi a Max.

- [ ] **Step 2: Run** `pnpm typecheck` → PASS.

- [ ] **Step 3: Commit** `git add lib/outreach/move-to-waiting.ts && git commit -m "feat(outreach): sposta il lead a In attesa dopo il primo contatto approvato"`

---

### Task 7: Esecuzione approva/rifiuta (dipendenze iniettate)

**Files:**
- Create: `lib/outreach/execute.ts`
- Test: `tests/unit/outreach-execute.test.ts`

- [ ] **Step 1: Test che fallisce**

```ts
import { describe, expect, it, vi } from "vitest";

import { eseguiDecisione, type DipendenzeEsecuzione, type PropostaDaEseguire } from "@/lib/outreach/execute";

const P: PropostaDaEseguire = {
  id: "p1", organizationId: "o1", leadId: "l1", contactId: "c1", kind: "first_contact",
  status: "pending", toAddress: "info@x.it", subject: "S", body: "B", contactBlocked: false,
};

function deps(over: Partial<DipendenzeEsecuzione> = {}): DipendenzeEsecuzione {
  return {
    dryRun: false,
    send: vi.fn(async () => ({ ok: true, id: "re_1" })),
    salva: vi.fn(async () => true),
    spostaInAttesa: vi.fn(async () => "movido" as const),
    nota: vi.fn(async () => undefined),
    ...over,
  };
}

describe("eseguiDecisione", () => {
  it("rifiuta: nessun invio, nessuno spostamento", async () => {
    const d = deps();
    const r = await eseguiDecisione(P, { azione: "rifiuta", userId: "u1" }, d);
    expect(r.status).toBe("rejected");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.spostaInAttesa).not.toHaveBeenCalled();
  });
  it("dry-run: nessun invio ma sent+sposta+nota", async () => {
    const d = deps({ dryRun: true });
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(r.status).toBe("sent");
    expect(d.salva).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", dry_run: true }));
    expect(d.spostaInAttesa).toHaveBeenCalled();
    expect(d.nota).toHaveBeenCalled();
  });
  it("invio reale ok", async () => {
    const d = deps();
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(d.send).toHaveBeenCalledWith(expect.objectContaining({ to: "info@x.it", subject: "S" }));
    expect(r.status).toBe("sent");
    expect(d.salva).toHaveBeenCalledWith(expect.objectContaining({ provider_message_id: "re_1", dry_run: false }));
  });
  it("invio fallito: failed, niente spostamento", async () => {
    const d = deps({ send: vi.fn(async () => ({ ok: false, error: "send_failed" as const })) });
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(r.status).toBe("failed");
    expect(d.spostaInAttesa).not.toHaveBeenCalled();
  });
  it("contatto bloccato nel frattempo: nessun invio", async () => {
    const d = deps();
    const r = await eseguiDecisione({ ...P, contactBlocked: true }, { azione: "approva", userId: "u1" }, d);
    expect(d.send).not.toHaveBeenCalled();
    expect(r.status).toBe("rejected");
  });
  it("proposta non più pending: nessuna azione", async () => {
    const d = deps();
    const r = await eseguiDecisione({ ...P, status: "sent" }, { azione: "approva", userId: "u1" }, d);
    expect(r.status).toBe("non_pending");
    expect(d.send).not.toHaveBeenCalled();
    expect(d.salva).not.toHaveBeenCalled();
  });
  it("ricontatto approvato: non sposta lo stage", async () => {
    const d = deps();
    await eseguiDecisione({ ...P, kind: "followup" }, { azione: "approva", userId: "u1" }, d);
    expect(d.spostaInAttesa).not.toHaveBeenCalled();
  });
  it("salvataggio concorrente perso: nessun invio", async () => {
    const d = deps({ salva: vi.fn(async () => false) });
    const r = await eseguiDecisione(P, { azione: "approva", userId: "u1" }, d);
    expect(r.status).toBe("non_pending");
    expect(d.send).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/outreach-execute.test.ts` → FAIL.

- [ ] **Step 3: Implementa**

```ts
import type { OutreachKind } from "@/lib/outreach/templates";

export interface PropostaDaEseguire {
  id: string;
  organizationId: string;
  leadId: string;
  contactId: string | null;
  kind: OutreachKind;
  status: string;
  toAddress: string;
  subject: string | null;
  body: string;
  contactBlocked: boolean;
}

export interface DipendenzeEsecuzione {
  dryRun: boolean;
  send: (args: { to: string; subject: string; text: string; html: string }) => Promise<{ ok: boolean; id?: string; error?: string }>;
  /**
   * Aggiorna la proposta SOLO se lo stato atteso corrisponde (trava ottimista).
   * Ritorna false se un altro utente l'ha già decisa.
   */
  salva: (patch: Record<string, unknown> & { expectStatus: string }) => Promise<boolean>;
  spostaInAttesa: () => Promise<"movido" | "non_in_da_contattare" | "errore">;
  nota: (testo: string) => Promise<void>;
}

export type Decisione = { azione: "approva" | "rifiuta"; userId: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function eseguiDecisione(
  p: PropostaDaEseguire,
  d: Decisione,
  deps: DipendenzeEsecuzione,
): Promise<{ status: "rejected" | "sent" | "failed" | "non_pending"; errore?: string }> {
  if (p.status !== "pending") return { status: "non_pending" };
  const ora = new Date().toISOString();

  if (d.azione === "rifiuta" || p.contactBlocked) {
    const ok = await deps.salva({
      expectStatus: "pending",
      status: "rejected",
      decided_by: d.userId,
      decided_at: ora,
      error: p.contactBlocked ? "contatto_bloccato" : null,
    });
    return ok ? { status: "rejected" } : { status: "non_pending" };
  }

  // Blocca la proposta prima di inviare: due clic non producono due email.
  const preso = await deps.salva({ expectStatus: "pending", status: "approved", decided_by: d.userId, decided_at: ora, dry_run: deps.dryRun });
  if (!preso) return { status: "non_pending" };

  let providerId: string | null = null;
  if (!deps.dryRun) {
    const r = await deps.send({
      to: p.toAddress,
      subject: p.subject ?? "",
      text: p.body,
      html: `<div style="white-space:pre-line;font-family:sans-serif">${escapeHtml(p.body)}</div>`,
    });
    if (!r.ok) {
      await deps.salva({ expectStatus: "approved", status: "failed", error: r.error ?? "send_failed" });
      return { status: "failed", errore: r.error };
    }
    providerId = r.id ?? null;
  }

  await deps.salva({
    expectStatus: "approved",
    status: "sent",
    sent_at: new Date().toISOString(),
    provider_message_id: providerId,
    dry_run: deps.dryRun,
  });
  if (p.kind === "first_contact") await deps.spostaInAttesa();
  const etichetta = p.kind === "first_contact" ? "Primo contatto" : "Ricontatto";
  await deps.nota(
    deps.dryRun
      ? `${etichetta} email approvato (modalità prova: nessun invio reale). Oggetto: ${p.subject ?? ""}`
      : `${etichetta} email inviato. Oggetto: ${p.subject ?? ""}`,
  );
  return { status: "sent" };
}
```

- [ ] **Step 4: Run** `pnpm vitest run tests/unit/outreach-execute.test.ts` → PASS.

- [ ] **Step 5: Commit** `git add lib/outreach/execute.ts tests/unit/outreach-execute.test.ts && git commit -m "feat(outreach): esecuzione approva/rifiuta con dry-run e trava contro doppio invio"`

---

### Task 8: Server actions + pagina "Da approvare" + navigazione + i18n

**Files:**
- Create: `app/actions/outreach/decide.ts`
- Create: `app/app/outreach/page.tsx`
- Create: `app/app/outreach/_components/OutreachQueue.tsx`
- Modify: `lib/navigation/catalogo.ts` (`NAV_CATALOG`)
- Modify: `lib/i18n/dicionario.ts`

- [ ] **Step 1: Server actions**

```ts
"use server";

import { revalidatePath } from "next/cache";

import { loadAuthUser, resolveActiveOrg } from "@/lib/auth/server";
import { ROLE_RANK } from "@/lib/auth/types";
import { sendEmail } from "@/lib/email/resend";
import { supportWriteError } from "@/lib/impersonate/support";
import { emitLeadActivity } from "@/lib/leads/activity-emitter";
import { isOutreachDryRun } from "@/lib/outreach/config";
import { eseguiDecisione } from "@/lib/outreach/execute";
import { spostaInAttesa } from "@/lib/outreach/move-to-waiting";
import { createClient } from "@/lib/supabase/server";

type Risultato = { ok: true; status: string } | { ok: false; error: string };

async function contesto() {
  const user = await loadAuthUser();
  if (!user) return { error: "unauthenticated" as const };
  if (supportWriteError(user.support)) return { error: "forbidden" as const };
  const org = await resolveActiveOrg(user);
  if (!org) return { error: "forbidden_tenant" as const };
  if (!user.is_platform_admin && ROLE_RANK[org.role] < ROLE_RANK.agent) return { error: "forbidden_role" as const };
  return { user, org };
}

export async function decidiProposta(id: string, azione: "approva" | "rifiuta"): Promise<Risultato> {
  const ctx = await contesto();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const supabase = await createClient();

  const { data: row } = await supabase
    .from("outreach_proposals")
    .select("id, organization_id, lead_id, contact_id, kind, status, to_address, subject, body, contacts(is_blocked)")
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "not_found" };
  const contatto = (Array.isArray(row.contacts) ? row.contacts[0] : row.contacts) as { is_blocked: boolean } | null;

  const r = await eseguiDecisione(
    {
      id: row.id, organizationId: row.organization_id, leadId: row.lead_id, contactId: row.contact_id,
      kind: row.kind, status: row.status, toAddress: row.to_address, subject: row.subject, body: row.body,
      contactBlocked: contatto?.is_blocked ?? false,
    },
    { azione, userId: ctx.user.id },
    {
      dryRun: isOutreachDryRun(),
      send: (a) => sendEmail({ ...a, fromName: "Max · All-io" }),
      salva: async ({ expectStatus, ...patch }) => {
        const { data } = await supabase
          .from("outreach_proposals")
          .update(patch)
          .eq("id", row.id)
          .eq("status", expectStatus)
          .select("id");
        return (data ?? []).length > 0;
      },
      spostaInAttesa: () =>
        spostaInAttesa(supabase, { organizationId: ctx.org.id, leadId: row.lead_id, contactId: row.contact_id, userId: ctx.user.id }),
      nota: async (testo) => {
        await emitLeadActivity(supabase, {
          organizationId: ctx.org.id, leadId: row.lead_id, contactId: row.contact_id,
          type: "note", sourceModule: "outreach", sourceId: row.id,
          actor: { type: "user", id: ctx.user.id }, reason: testo, payload: { proposal_id: row.id },
        });
      },
    },
  );
  revalidatePath("/app/outreach");
  return r.status === "failed" ? { ok: false, error: r.errore ?? "send_failed" } : { ok: true, status: r.status };
}

export async function modificaProposta(id: string, subject: string, body: string): Promise<Risultato> {
  const ctx = await contesto();
  if ("error" in ctx) return { ok: false, error: ctx.error };
  const s = subject.trim().slice(0, 200);
  const b = body.trim().slice(0, 5000);
  if (!s || !b) return { ok: false, error: "validation_failed" };
  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_proposals")
    .update({ subject: s, body: b })
    .eq("id", id)
    .eq("organization_id", ctx.org.id)
    .eq("status", "pending")
    .select("id");
  revalidatePath("/app/outreach");
  return (data ?? []).length > 0 ? { ok: true, status: "pending" } : { ok: false, error: "non_pending" };
}
```

Verifica prima: `ROLE_RANK.agent` esiste in `lib/auth/types.ts` (`grep -n "ROLE_RANK" -A8 lib/auth/types.ts`); `sendEmail` è l'export di `lib/email/resend.ts` (verificato il 2026-09-17). Se il nome o il ruolo differiscono, usa quelli reali. Se `createClient()` è tipizzato con i tipi generati e `outreach_proposals` non c'è, rigenera i tipi come fa il repo (vedi `CLAUDE.md`) invece di usare `any`.

- [ ] **Step 2: Pagina**

```tsx
import { redirect } from "next/navigation";

import { requireAuth, resolveActiveOrg } from "@/lib/auth/server";
import { traduzir } from "@/lib/i18n/dicionario";
import { isOutreachDryRun } from "@/lib/outreach/config";
import { createClient } from "@/lib/supabase/server";
import { OutreachQueue, type RigaCoda } from "./_components/OutreachQueue";

export const dynamic = "force-dynamic";

export default async function OutreachPage() {
  const user = await requireAuth();
  const activeOrg = await resolveActiveOrg(user);
  if (!activeOrg) redirect("/app");
  const t = (texto: string) => traduzir(texto, user.idioma);

  const supabase = await createClient();
  const { data } = await supabase
    .from("outreach_proposals")
    .select("id, status, kind, to_address, subject, body, reason, dry_run, created_at, decided_at, error, crm_leads(title)")
    .eq("organization_id", activeOrg.id)
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
```

- [ ] **Step 3: Componente client**

```tsx
"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { decidiProposta, modificaProposta } from "@/app/actions/outreach/decide";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useT } from "@/hooks/i18n/useT";

export interface RigaCoda {
  id: string;
  status: string;
  kind: string;
  to_address: string;
  subject: string | null;
  body: string;
  reason: string;
  dry_run: boolean;
  created_at: string;
  decided_at: string | null;
  error: string | null;
  leadTitle: string;
}

export function OutreachQueue({ righe }: { righe: RigaCoda[] }) {
  const t = useT();
  const pending = righe.filter((r) => r.status === "pending");
  const storico = righe.filter((r) => r.status !== "pending");

  return (
    <div className="flex flex-col gap-8">
      <section className="flex flex-col gap-4">
        {pending.length === 0 && <p className="text-sm text-muted-foreground">{t("Nenhum e-mail para aprovar.")}</p>}
        {pending.map((r) => (
          <Scheda key={r.id} riga={r} />
        ))}
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">{t("Histórico")}</h2>
        {storico.map((r) => (
          <div key={r.id} className="flex items-center gap-3 text-sm">
            <Badge variant="outline">{t(r.status === "sent" && r.dry_run ? "Teste" : r.status)}</Badge>
            <span className="font-medium">{r.leadTitle}</span>
            <span className="text-muted-foreground">{r.subject}</span>
            {r.error && <span className="text-destructive">{r.error}</span>}
          </div>
        ))}
      </section>
    </div>
  );
}

function Scheda({ riga }: { riga: RigaCoda }) {
  const t = useT();
  const [pending, start] = useTransition();
  const [modifica, setModifica] = useState(false);
  const [subject, setSubject] = useState(riga.subject ?? "");
  const [body, setBody] = useState(riga.body);

  const esegui = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const r = await fn();
      if (!r.ok) toast.error(r.error ?? "erro");
    });

  return (
    <article className="rounded-lg border p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="font-medium">{riga.leadTitle}</span>
        <Badge variant="secondary">{t(riga.kind === "first_contact" ? "Primeiro contato" : "Novo contato")}</Badge>
        <span className="text-sm text-muted-foreground">{riga.to_address}</span>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{riga.reason}</p>
      {modifica ? (
        <div className="flex flex-col gap-2">
          <input className="rounded border px-2 py-1" value={subject} onChange={(e) => setSubject(e.target.value)} />
          <textarea className="min-h-48 rounded border px-2 py-1" value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
      ) : (
        <>
          <p className="font-medium">{riga.subject}</p>
          <pre className="whitespace-pre-wrap font-sans text-sm">{riga.body}</pre>
        </>
      )}
      <div className="mt-3 flex gap-2">
        {modifica ? (
          <Button disabled={pending} onClick={() => esegui(async () => { const r = await modificaProposta(riga.id, subject, body); if (r.ok) setModifica(false); return r; })}>
            {t("Salvar")}
          </Button>
        ) : (
          <>
            <Button disabled={pending} onClick={() => esegui(() => decidiProposta(riga.id, "approva"))}>{t("Aprovar")}</Button>
            <Button variant="outline" disabled={pending} onClick={() => setModifica(true)}>{t("Editar")}</Button>
            <Button variant="ghost" disabled={pending} onClick={() => esegui(() => decidiProposta(riga.id, "rifiuta"))}>{t("Recusar")}</Button>
          </>
        )}
      </div>
    </article>
  );
}
```

- [ ] **Step 4: Navigazione** — in `lib/navigation/catalogo.ts`, dentro `NAV_CATALOG`, vicino alle voci del gruppo `crm`, aggiungi (usa un'icona già presente in `lib/ui/icons`; controlla con `grep -n "icon:" lib/navigation/catalogo.ts | head`):

```ts
  {
    href: "/app/outreach",
    label: "Para aprovar",
    description: "E-mails que o agente preparou e que só saem com a sua aprovação.",
    icon: "Inbox",
    group: "crm",
    sidebar: true,
  },
```

- [ ] **Step 5: i18n** — in `lib/i18n/dicionario.ts` aggiungi (in ordine con le altre voci):

```ts
  "Para aprovar": { es: "Por aprobar", it: "Da approvare", en: "To approve" },
  "O agente prepara os e-mails; nada sai sem a sua aprovação.": { es: "El agente prepara los correos; nada sale sin tu aprobación.", it: "L'agente prepara le email; non parte nulla senza la tua approvazione.", en: "The agent drafts the emails; nothing goes out without your approval." },
  "Modo de teste: aprovar não envia nenhum e-mail de verdade.": { es: "Modo de prueba: aprobar no envía ningún correo real.", it: "Modalità prova: approvare non invia nessuna email vera.", en: "Test mode: approving does not send any real email." },
  "E-mails que o agente preparou e que só saem com a sua aprovação.": { es: "Correos que el agente preparó y que solo salen con tu aprobación.", it: "Email preparate dall'agente che partono solo con la tua approvazione.", en: "Emails the agent drafted that only go out with your approval." },
  "Nenhum e-mail para aprovar.": { es: "Ningún correo por aprobar.", it: "Nessuna email da approvare.", en: "No emails to approve." },
  "Histórico": { es: "Historial", it: "Storico", en: "History" },
  "Teste": { es: "Prueba", it: "Prova", en: "Test" },
  "Primeiro contato": { es: "Primer contacto", it: "Primo contatto", en: "First contact" },
  "Novo contato": { es: "Nuevo contacto", it: "Ricontatto", en: "Follow-up" },
  "Aprovar": { es: "Aprobar", it: "Approva", en: "Approve" },
  "Editar": { es: "Editar", it: "Modifica", en: "Edit" },
  "Recusar": { es: "Rechazar", it: "Rifiuta", en: "Reject" },
  "Salvar": { es: "Guardar", it: "Salva", en: "Save" },
  "sent": { es: "enviado", it: "inviata", en: "sent" },
  "rejected": { es: "rechazado", it: "rifiutata", en: "rejected" },
  "failed": { es: "falló", it: "fallita", en: "failed" },
  "approved": { es: "aprobado", it: "approvata", en: "approved" },
```

Prima di aggiungere, controlla con `grep -n '^  "Histórico"\|^  "Editar"\|^  "Salvar"\|^  "Aprovar"' lib/i18n/dicionario.ts`: le chiavi già presenti NON vanno duplicate (TypeScript darebbe errore di chiave doppia).

- [ ] **Step 6: Run** `pnpm typecheck && pnpm lint && pnpm vitest run tests/unit/navegacao-completude.test.ts tests/unit/navegacao-registry.test.ts` e il test i18n spagnolo (`ls tests/unit | grep -i espanhol`) → PASS.

- [ ] **Step 7: Commit** `git add app/actions/outreach app/app/outreach lib/navigation/catalogo.ts lib/i18n/dicionario.ts && git commit -m "feat(outreach): pagina Da approvare con approva, modifica e rifiuta"`

---

### Task 9: Barriera "l'LLM non invia"

**Files:**
- Test: `tests/unit/outreach-isolamento.test.ts`

- [ ] **Step 1: Scrivi il test**

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

function fileTs(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? fileTs(p) : /\.tsx?$/.test(n) ? [p] : [];
  });
}

describe("agente outreach: l'LLM non può inviare", () => {
  it("nessun file del motore IA importa lib/outreach", () => {
    const colpevoli = [...fileTs(join(RAIZ, "lib", "agent-engine")), ...fileTs(join(RAIZ, "lib", "ai"))]
      .filter((f) => readFileSync(f, "utf8").includes("@/lib/outreach"));
    expect(colpevoli).toEqual([]);
  });
  it("lib/outreach non importa SDK di modelli", () => {
    const colpevoli = fileTs(join(RAIZ, "lib", "outreach"))
      .filter((f) => /from "(ai|@ai-sdk\/[^"]+|@anthropic-ai\/[^"]+|openai)"/.test(readFileSync(f, "utf8")));
    expect(colpevoli).toEqual([]);
  });
  it("solo la server action chiama l'invio email", () => {
    const colpevoli = fileTs(join(RAIZ, "lib", "outreach"))
      .filter((f) => readFileSync(f, "utf8").includes("@/lib/email/resend"));
    expect(colpevoli).toEqual([]);
  });
});
```

- [ ] **Step 2: Run** `pnpm vitest run tests/unit/outreach-isolamento.test.ts` → PASS.

- [ ] **Step 3: Commit** `git add tests/unit/outreach-isolamento.test.ts && git commit -m "test(outreach): barriera, il motore IA non raggiunge l'invio"`

---

### Task 10: Verifica completa, prova locale, report

- [ ] **Step 1: Suite completa**

Run: `pnpm typecheck && pnpm lint && pnpm test:unit && pnpm test:db`
Expected: tutto PASS. Riporta l'output reale nel report, anche i fallimenti.

- [ ] **Step 2: Prova locale con dati finti** (niente dati veri, niente chiavi di produzione)

1. Avvia lo stack locale come da `CLAUDE.md` (`pnpm dev`, Supabase locale).
2. Crea in locale un'org di prova con pipeline `milano-prospect` e 3 lead finti (uno con "Dentistico" nel titolo, uno con "Estetica", uno con contatto `is_blocked = true`), email `@example.com`.
3. Metti `OUTREACH_ORG_ID=<id org di prova>`, lascia `OUTREACH_DRY_RUN` vuoto.
4. Chiama `curl -H "Authorization: Bearer $INTERNAL_SECRET" http://localhost:3000/api/v1/cron/outreach-proposals` (in orario 9-19 Italia).
5. Atteso: 2 proposte `pending` (il bloccato no). Seconda chiamata: 0 nuove.
6. Da `/app/outreach`: approva la prima → stato `Teste`, lead in "In attesa", nota in timeline, nessuna email partita. Rifiuta la seconda → `rejected`, lead fermo.

- [ ] **Step 3: Report** — scrivi `prompts/out/CRM-ALLIO-AGENT-P0.md` con: cosa è stato fatto, commit, output dei test, esito prova locale, checklist acceptance della spec, e la lista "Prima degli invii veri" qui sotto.

**Prima degli invii veri (decide Max, non l'esecutore):**
1. Max rivede e approva i testi dei modelli (Task 3).
2. Dominio `all-io.com` verificato su Resend nell'ambiente di produzione; `RESEND_FROM_EMAIL` = indirizzo di Max.
3. Controllare che l'org All-io non abbia automazioni che reagiscono a `lead.stage_changed` o a nuove note sulla pipeline Milano.
4. Le risposte "STOP" arrivano nella casella di Max, non nel CRM: chi le riceve deve bloccare a mano il contatto nel CRM.
5. Deploy in produzione con `OUTREACH_DRY_RUN` vuoto, un giro di prova, poi `OUTREACH_DRY_RUN=false` solo con ok esplicito di Max.

- [ ] **Step 4: Commit** `git add prompts/out/CRM-ALLIO-AGENT-P0.md && git commit -m "docs(outreach): report P0"` — **nessun push**.
