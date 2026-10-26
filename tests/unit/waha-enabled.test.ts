/**
 * WAHA_ENABLED — só o literal `false` desliga.
 *
 * Instalação que não usa o transporte (o canal é outro) não pode levar 503 no
 * /api/v1/health nem um warn por tick no watchdog. Quem ainda usa WAHA não
 * escreve a variável, e o comportamento de hoje tem de continuar: serviço
 * inalcançável = unhealthy.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type pg from "pg";
import { NextRequest } from "next/server";

import { createLogger } from "@/lib/agent-engine/obs/logger";
import {
  reconcileSessions,
  redriveQueued,
  runSessionWatchdogLoop,
  type WatchdogConfig,
} from "@/lib/agent-engine/edge/crm/session-reconciler";
import { getAdapter } from "@/lib/channels";
import { DETALHE_TRANSPORTE_DESLIGADO, avisoDaConexao } from "@/lib/channels/health";
import { wahaHabilitado } from "@/lib/waha/habilitado";
import { WahaClient } from "@/lib/waha/client";

const ORG = "00000000-0000-4000-8000-000000000236";

function cfg(): WatchdogConfig {
  return {
    wahaBaseUrl: "http://waha.interno:3000",
    wahaApiKey: "chave-de-teste",
    intervalMs: 60_000,
    redriveMinAgeMs: 0,
    redriveBatchSize: 10,
    redriveSpacingMs: 0,
  };
}

function pedido(): NextRequest {
  return new NextRequest("http://crm.interno/api/v1/health");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("@/lib/env");
  vi.resetModules();
});

describe("wahaHabilitado", () => {
  it.each(["false"])("só %j desliga", (valor) => {
    expect(wahaHabilitado({ WAHA_ENABLED: valor })).toBe(false);
  });

  it.each([undefined, "", "true", "TRUE", "FALSE", "0", "no", "off", "falso"])(
    "%j deixa ligado",
    (valor) => {
      expect(wahaHabilitado({ WAHA_ENABLED: valor })).toBe(true);
    },
  );
});

describe("GET /api/v1/health", () => {
  async function carregar(wahaEnabled: string | undefined) {
    vi.resetModules();
    if (wahaEnabled === undefined) delete process.env.WAHA_ENABLED;
    else vi.stubEnv("WAHA_ENABLED", wahaEnabled);

    vi.doMock("@/lib/env", () => ({
      env: {
        NEXT_PUBLIC_SUPABASE_URL: "https://projeto.supabase.co",
        NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-teste",
        UPSTASH_REDIS_REST_URL: "http://redis.interno",
        UPSTASH_REDIS_REST_TOKEN: "token-teste",
        WAHA_API_BASE_URL: "http://waha.interno:3000",
        WAHA_API_KEY: "chave-de-teste",
        INTERNAL_CRON_SECRET: "",
        INTERNAL_SECRET: "",
      },
    }));

    const fetchMock = vi.fn(async (url: RequestInfo | URL) => {
      if (String(url).includes("/api/sessions")) {
        throw new Error("connect ECONNREFUSED 10.0.0.8:3000");
      }
      return new Response("{}", { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { GET } = await import("@/app/api/v1/health/route");
    return { GET, fetchMock };
  }

  it("WAHA_ENABLED=false e WAHA inalcançável: 200, healthy, waha disabled, sem chamada", async () => {
    const { GET, fetchMock } = await carregar("false");
    const res = await GET(pedido());
    const { data } = await res.json();

    expect(res.status).toBe(200);
    expect(data.status).toBe("healthy");
    expect(data.checks.waha).toEqual({ status: "disabled", latency_ms: 0 });
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/sessions"))).toBe(false);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("waha.interno"))).toBe(false);
  });

  it("padrão (variável ausente) e WAHA inalcançável: 503, como hoje", async () => {
    const { GET, fetchMock } = await carregar(undefined);
    const res = await GET(pedido());
    const { data } = await res.json();

    expect(res.status).toBe(503);
    expect(data.status).toBe("unhealthy");
    expect(data.checks.waha.status).toBe("down");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/sessions"))).toBe(true);
  });

  it.each(["FALSE", "0", "no", ""])(
    "WAHA_ENABLED=%j é tratado como ligado e o WAHA inalcançável segue 503",
    async (valor) => {
      const { GET, fetchMock } = await carregar(valor);
      const res = await GET(pedido());
      const { data } = await res.json();

      expect(res.status).toBe(503);
      expect(data.status).toBe("unhealthy");
      expect(data.checks.waha.status).toBe("down");
      expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/api/sessions"))).toBe(true);
    },
  );
});

describe("watchdog", () => {
  it("não consulta /api/sessions e não loga erro quando o WAHA está desligado", async () => {
    vi.stubEnv("WAHA_ENABLED", "false");
    const fetchMock = vi.fn(async () => {
      throw new Error("não deveria chamar a rede");
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = createLogger();
    const warn = vi.spyOn(log, "warn");
    const error = vi.spyOn(log, "error");
    const query = vi.fn();
    const pool = { query } as unknown as pg.Pool;

    await runSessionWatchdogLoop(pool, cfg(), log, new AbortController().signal);
    expect(await reconcileSessions(pool, cfg(), log)).toBe(0);
    expect(await redriveQueued(pool, cfg(), log)).toBe(0);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(query).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it("um valor diferente de false continua perguntando /api/sessions", async () => {
    vi.stubEnv("WAHA_ENABLED", "FALSE");
    const fetchMock = vi.fn(async (_url: RequestInfo | URL) => {
      throw new Error("connect ECONNREFUSED");
    });
    vi.stubGlobal("fetch", fetchMock);
    const log = createLogger();

    await reconcileSessions({ query: vi.fn() } as unknown as pg.Pool, cfg(), log);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/sessions");
  });
});

describe("envio e sessão", () => {
  it("recusa o envio sem chamada de rede", async () => {
    vi.stubEnv("WAHA_ENABLED", "false");
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha.interno:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-de-teste");
    const fetchMock = vi.fn(async () => {
      throw new Error("não deveria chamar a rede");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      getAdapter("waha").send({
        organizationId: ORG,
        sessionRef: "s",
        to: "5531999998888@c.us",
        kind: "text",
        body: "oi",
      }),
    ).rejects.toThrow(/waha_disabled/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("recusa abrir sessão sem chamada de rede", async () => {
    vi.stubEnv("WAHA_ENABLED", "false");
    const fetchMock = vi.fn(async () => {
      throw new Error("não deveria chamar a rede");
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(new WahaClient("http://waha.interno:3000", "chave-de-teste").startSession("s1")).rejects.toThrow(
      /waha_disabled/,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("o vigia de canal não pergunta a sessão desligada e não abre aviso", async () => {
    vi.stubEnv("WAHA_ENABLED", "false");
    vi.stubEnv("WAHA_API_BASE_URL", "http://waha.interno:3000");
    vi.stubEnv("WAHA_API_KEY", "chave-de-teste");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const saude = await getAdapter("waha").checkHealth?.({
      organizationId: ORG,
      sessionRef: "s1",
    });

    expect(saude).toEqual({
      reachable: false,
      status: null,
      detail: DETALHE_TRANSPORTE_DESLIGADO,
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(avisoDaConexao(saude!, "número")).toBeNull();
  });
});
