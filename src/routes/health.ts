import type { Db } from "../db/pool.js";
import type { RouteTable } from "../http/route-table.js";

export function registerHealthRoutes(routes: RouteTable, db: Db): void {
  routes.add("GET", "/api/v1/health", async (_req, res) => {
    try {
      await db.query("SELECT 1");
      res.status(200).json({ message: "OK" });
    } catch {
      res.status(503).json({ message: "Service unavailable" });
    }
  });
}
