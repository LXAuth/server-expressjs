import type { ErrorRequestHandler } from "express";
import { ZodError } from "zod";

/** An error whose status and message are safe to show to the caller. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly headers: Record<string, string> = {},
  ) {
    super(message);
    this.name = "HttpError";
  }
}

export const notFound = () => new HttpError(404, "Not found");
export const unauthorized = (message = "Unauthorized") => new HttpError(401, message);

interface BodyParserError {
  type?: string;
  status?: number;
}

/**
 * The last middleware. It decides what a caller may learn from a failure:
 * a fixed message per status, never a stack trace or an internal error string.
 */
export function errorHandler(log: (err: unknown) => void = console.error): ErrorRequestHandler {
  return (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.set(err.headers).status(err.status).json({ message: err.message });
      return;
    }
    if (err instanceof ZodError) {
      res.status(400).json({
        message: "Invalid request",
        errors: err.issues.map((i) => ({ field: i.path.join("."), message: i.message })),
      });
      return;
    }
    const parser = err as BodyParserError;
    if (parser.type === "entity.too.large") {
      res.status(413).json({ message: "Request body too large" });
      return;
    }
    if (parser.type === "entity.parse.failed" || parser.type === "encoding.unsupported") {
      res.status(400).json({ message: "Malformed request body" });
      return;
    }
    log(err);
    res.status(500).json({ message: "Internal server error" });
  };
}
