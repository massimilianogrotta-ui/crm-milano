import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

import { env } from "@/lib/env";
import { validarConfigRedisRest } from "@/lib/redis-config";

/** Serializza conteggio e mutazione per org anche tra istanze Next diverse. */
export async function bloccaOutreach(orgId: string): Promise<(() => Promise<void>) | null> {
  const config = validarConfigRedisRest(env.UPSTASH_REDIS_REST_URL, env.UPSTASH_REDIS_REST_TOKEN);
  if (!config.ok) throw new Error("outreach_lock_unavailable");
  const redis = new Redis({ url: env.UPSTASH_REDIS_REST_URL, token: env.UPSTASH_REDIS_REST_TOKEN, retry: false });
  const key = `outreach:lock:${orgId}`;
  const token = randomUUID();
  const acquired = await redis.set(key, token, { nx: true, ex: 300 });
  if (acquired !== "OK") return null;
  return async () => {
    await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [key], [token]);
  };
}
