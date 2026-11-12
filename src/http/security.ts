import type { RequestHandler } from "express";
import { HttpError } from "./errors.js";

/** API responses are per-caller and must never be stored by a cache or proxy. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.set("Cache-Control", "no-store");
  res.set("Pragma", "no-cache");
  next();
};

function hasBody(headers: Record<string, string | string[] | undefined>): boolean {
  const length = headers["content-length"];
  if (headers["transfer-encoding"] !== undefined) return true;
  return length !== undefined && length !== "0";
}

/** A request that carries a body must declare it as JSON. */
export const requireJsonBody: RequestHandler = (req, _res, next) => {
  if (hasBody(req.headers) && !req.is("application/json")) {
    next(new HttpError(415, "Content-Type must be application/json"));
    return;
  }
  next();
};
