import type { RequestHandler, Router } from "express";
import { HttpError, notFound } from "./errors.js";

export type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface DeclaredRoute {
  method: Method;
  path: string;
  segments: string[];
}

const MAX_PATH_LENGTH = 512;
const MAX_QUERY_LENGTH = 2048;

/**
 * Patterns that never appear in a declared route but are common in traversal,
 * smuggling, and encoding tricks. Checked against the raw request path; the
 * query string is only checked for length and null bytes, because provider
 * callbacks legitimately carry encoded URLs there.
 */
const SUSPICIOUS = [
  /\.\./, // dot-dot traversal
  /%2e/i, // encoded dot
  /%2f/i, // encoded slash
  /%5c/i, // encoded backslash
  /\\/, // raw backslash
  /%00|\0/i, // null byte
  /%25/i, // double encoding
  /\/\//, // empty segment
  /[^\x21-\x7e]/, // whitespace, control, or non-ASCII characters
];

function splitPath(path: string): string[] {
  return path.split("/").slice(1);
}

/**
 * The allowlist of every URL this server answers. Routes are registered
 * through it, and the guard it provides rejects anything that is not on it
 * before any parsing, authentication, or database work happens.
 */
export class RouteTable {
  private readonly routes: DeclaredRoute[] = [];

  constructor(private readonly router: Router) {}

  add(method: Method, path: string, ...handlers: RequestHandler[]): this {
    if (!/^(\/[a-z0-9_-]+|\/:[a-zA-Z]+)+$|^\/$/.test(path)) {
      throw new Error(`Route path is not allowed by the route table: ${path}`);
    }
    this.routes.push({ method, path, segments: splitPath(path) });
    const verb = method.toLowerCase() as Lowercase<Method>;
    this.router[verb](path, ...handlers);
    return this;
  }

  /** Every declared route, for documentation and tests. */
  list(): ReadonlyArray<{ method: Method; path: string }> {
    return this.routes.map(({ method, path }) => ({ method, path }));
  }

  private methodsFor(path: string): Set<Method> {
    const parts = splitPath(path);
    const methods = new Set<Method>();
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const matches = route.segments.every((segment, i) => {
        const part = parts[i] ?? "";
        return segment.startsWith(":") ? /^[A-Za-z0-9_-]{1,128}$/.test(part) : segment === part;
      });
      if (matches) methods.add(route.method);
    }
    return methods;
  }

  /**
   * Runs before everything else. Unknown or malformed URLs get one generic 404
   * so a caller learns nothing about what exists; a known URL with the wrong
   * method gets 405 with an `Allow` header.
   */
  guard(): RequestHandler {
    return (req, _res, next) => {
      const raw = req.originalUrl;
      const queryAt = raw.indexOf("?");
      const path = queryAt === -1 ? raw : raw.slice(0, queryAt);
      const query = queryAt === -1 ? "" : raw.slice(queryAt + 1);

      if (
        path.length > MAX_PATH_LENGTH ||
        SUSPICIOUS.some((p) => p.test(path)) ||
        query.length > MAX_QUERY_LENGTH ||
        /%00|[^\x20-\x7e]/i.test(query)
      ) {
        next(notFound());
        return;
      }

      const methods = this.methodsFor(path);
      if (methods.size === 0) {
        next(notFound());
        return;
      }

      const method = req.method === "HEAD" ? "GET" : req.method;
      if (!methods.has(method as Method)) {
        const allow = [...methods];
        if (methods.has("GET")) allow.push("HEAD" as Method);
        next(new HttpError(405, "Method not allowed", { Allow: allow.join(", ") }));
        return;
      }
      next();
    };
  }
}
