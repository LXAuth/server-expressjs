import type { RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";

export interface RateLimits {
  /** Requests per IP per 15 minutes across the whole API. */
  global: number;
  /** Login and client-management attempts per IP per 15 minutes. */
  auth: number;
  /** Account registrations per IP per hour. */
  register: number;
}

export const DEFAULT_RATE_LIMITS: RateLimits = { global: 600, auth: 20, register: 10 };

export function limiter(limit: number, windowMs: number): RequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { message: "Too many requests" },
  });
}
