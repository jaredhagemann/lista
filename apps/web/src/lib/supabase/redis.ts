import { Redis } from "@upstash/redis";

/**
 * Returns a Redis client configured from environment variables.
 * Extracted as a separate module so tests can mock it via vi.mock("@/lib/supabase/redis").
 */
export function getRedis(): Redis {
  return new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL!,
    token: process.env.UPSTASH_REDIS_REST_TOKEN!,
  });
}
