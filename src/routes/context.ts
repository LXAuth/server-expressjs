import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import type { RateLimits } from "../http/rate-limit.js";
import type { RouteTable } from "../http/route-table.js";

/** Everything a route module needs, passed in rather than imported, so tests can swap it. */
export interface AppContext {
  routes: RouteTable;
  db: Db;
  config: Config;
  rateLimits: RateLimits;
}
