import type { ProviderCode } from "../config.js";
import { getClient, getSession, requireClient, requireSession } from "../http/auth.js";
import { HttpError, notFound } from "../http/errors.js";
import { limiter } from "../http/rate-limit.js";
import { isProviderCode } from "../oauth/providers.js";
import { finishLink, listConnections, startLink, unlink } from "../services/connections.js";
import type { AppContext } from "./context.js";

function providerParam(value: unknown): ProviderCode {
  if (!isProviderCode(value)) throw notFound();
  return value;
}

export function registerConnectionRoutes({ routes, db, config, rateLimits, fetch }: AppContext): void {
  const client = requireClient(db);
  const session = requireSession(db);
  const callbackLimit = limiter(rateLimits.auth, 15 * 60 * 1000);

  routes.add("GET", "/api/v1/connections", client, session, async (_req, res) => {
    res.status(200).json({ connections: await listConnections(db, config, getSession(res).accountId) });
  });

  routes.add("POST", "/api/v1/connections/:provider", client, session, async (req, res) => {
    const provider = providerParam(req.params.provider);
    const url = await startLink(db, config, provider, getSession(res), getClient(res).redirectUri);
    res.status(200).json({ message: "Send the user to authorize_url", authorize_url: url });
  });

  routes.add("DELETE", "/api/v1/connections/:provider", client, session, async (req, res) => {
    const provider = providerParam(req.params.provider);
    await unlink(db, provider, getSession(res), req.ip);
    res.status(200).json({ message: "Provider unlinked" });
  });

  // Reached by the user's browser, coming back from GitHub or GitLab.
  routes.add("GET", "/api/v1/connections/:provider/callback", callbackLimit, async (req, res) => {
    const provider = providerParam(req.params.provider);
    const result = await finishLink(db, config, provider, req.query, fetch, req.ip);
    if (!result.redirectTo) throw new HttpError(400, "Invalid or expired link request");
    res.redirect(303, result.redirectTo);
  });
}
