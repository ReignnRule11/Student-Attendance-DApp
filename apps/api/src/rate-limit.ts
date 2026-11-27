import type { MiddlewareHandler } from "hono";

type Bucket = {
  count: number;
  resetAt: number;
};

export function createRateLimiter(options: {
  windowMs: number;
  maxRequests: number;
  keyPrefix: string;
}): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();

  return async (c, next) => {
    const now = Date.now();
    const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
    const clientIp = forwarded || c.req.header("x-real-ip") || "local";
    const key = `${options.keyPrefix}:${clientIp}`;

    const existing = buckets.get(key);
    if (!existing || existing.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (existing.count >= options.maxRequests) {
      const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfterSec));
      return c.json(
        { error: "Too many requests. Please try again later." },
        429,
      );
    }

    existing.count += 1;
    return next();
  };
}
