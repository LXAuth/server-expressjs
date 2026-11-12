import type { RouteTable } from "../http/route-table.js";

export function registerHealthRoutes(routes: RouteTable): void {
  routes.add("GET", "/api/v1/health", (_req, res) => {
    res.status(200).json({ message: "OK" });
  });
}
