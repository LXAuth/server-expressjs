import express, { type Express } from "express";
import helmet from "helmet";
import type { Config } from "./config.js";
import type { Db } from "./db/pool.js";
import { errorHandler, notFound } from "./http/errors.js";
import { DEFAULT_RATE_LIMITS, limiter, type RateLimits } from "./http/rate-limit.js";
import { RouteTable } from "./http/route-table.js";
import { noStore, requireJsonBody } from "./http/security.js";
import { registerAccountRoutes } from "./routes/accounts.js";
import type { AppContext } from "./routes/context.js";
import { registerHealthRoutes } from "./routes/health.js";

export interface AppDeps {
  config: Config;
  db: Db;
  /** Where unexpected errors are reported. Defaults to `console.error`. */
  log?: (err: unknown) => void;
  /** Per-IP request limits. Defaults to `DEFAULT_RATE_LIMITS`. */
  rateLimits?: Partial<RateLimits>;
}

export interface App {
  app: Express;
  routes: RouteTable;
}

export function createApp(deps: AppDeps): App {
  const { config } = deps;
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy);
  app.set("strict routing", true);
  app.set("case sensitive routing", true);
  app.set("query parser", "simple");
  app.set("json spaces", 0);

  const router = express.Router({ strict: true, caseSensitive: true });
  const routes = new RouteTable(router);

  // 1. Reject anything that is not a declared route before doing any work.
  app.use(routes.guard());

  // 2. Hardened response headers. Pages that need more relax this per route.
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'none'"],
        },
      },
      crossOriginResourcePolicy: { policy: "same-origin" },
      referrerPolicy: { policy: "no-referrer" },
    }),
  );
  app.use(noStore);

  // 3. Coarse per-IP limit. Sensitive routes add their own, tighter limits.
  const rateLimits: RateLimits = { ...DEFAULT_RATE_LIMITS, ...deps.rateLimits };
  app.use(limiter(rateLimits.global, 15 * 60 * 1000));

  // 4. Bodies are small JSON documents, nothing else.
  app.use(requireJsonBody, express.json({ limit: "10kb", strict: true, type: "application/json" }));

  const ctx: AppContext = { routes, db: deps.db, config, rateLimits };
  registerHealthRoutes(routes, deps.db);
  registerAccountRoutes(ctx);

  app.use(router);
  // A declared path whose handler chose not to answer still gets the generic 404.
  app.use((_req, _res, next) => next(notFound()));
  app.use(errorHandler(deps.log));

  return { app, routes };
}
