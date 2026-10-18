/**
 * A lista de canais (GET /api/v1/channel-sessions) è letta da QUALSIASI membro,
 * anche `viewer`. Upstream (#2318) ha iniziato a selezionare `metadata`, che
 * contiene i numeri di test dell'IA e altra configurazione interna, e poi ha
 * dovuto filtrarla (fad55aada). Nel fork la colonna non è mai stata selezionata:
 * questo test lo tiene fermo, così un futuro porting di #2318 senza filtro
 * diventa rosso qui.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

describe("GET /api/v1/channel-sessions — colonne della lista di qualsiasi membro", () => {
  it("non seleziona `metadata` né colonne di configurazione interna", async () => {
    const { CHANNEL_COLUMNS } = await import("@/app/api/v1/channel-sessions/route");
    const colonne = CHANNEL_COLUMNS.split(",").map((c) => c.trim());
    expect(colonne.length).toBeGreaterThan(5); // guardia di vacuità
    expect(colonne).not.toContain("metadata");
    expect(colonne.some((c) => c.startsWith("metadata") || c.includes("->"))).toBe(false);
  });
});
