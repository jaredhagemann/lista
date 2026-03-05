import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

// 5 signups per 10 minutes per IP
export const signupLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(5, "10 m"),
  prefix: "rl:signup",
});

// 20 invitations per hour per user
export const invitationLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(20, "1 h"),
  prefix: "rl:invitation",
});

// 30 notification sends per hour per user
export const notificationLimiter = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(30, "1 h"),
  prefix: "rl:notification",
});

export function rateLimitResponse() {
  return new Response(
    JSON.stringify({ error: "Too many requests. Please try again later." }),
    { status: 429, headers: { "Content-Type": "application/json" } }
  );
}
