import type { RequestHandler, Response } from "express";
import type { Config } from "../config.js";
import type { Db } from "../db/pool.js";
import { authenticate } from "../services/accounts.js";
import { authenticateClient, type AuthenticatedClient } from "../services/clients.js";
import { resolveSession, type SessionContext } from "../services/sessions.js";
import { HttpError, unauthorized } from "./errors.js";
import { emailField, passwordField } from "./validation.js";

const CLIENT_KEY = "lxauthClient";
const SESSION_KEY = "lxauthSession";
const OWNER_KEY = "lxauthOwner";

function header(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** Every login-related call must come from a registered client. */
export function requireClient(db: Db): RequestHandler {
  return async (req, res, next) => {
    const id = header(req.headers["x-client-id"]);
    const secret = header(req.headers["x-client-secret"]);
    const client = id && secret ? await authenticateClient(db, id, secret) : null;
    if (!client) {
      next(unauthorized("Invalid client credentials"));
      return;
    }
    res.locals[CLIENT_KEY] = client;
    next();
  };
}

/** A valid bearer session issued to the calling client. Must follow `requireClient`. */
export function requireSession(db: Db): RequestHandler {
  return async (req, res, next) => {
    const client = getClient(res);
    const auth = header(req.headers.authorization);
    const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : undefined;
    const session = token ? await resolveSession(db, token, client.id) : null;
    if (!session) {
      next(unauthorized("Invalid or expired session"));
      return;
    }
    res.locals[SESSION_KEY] = session;
    next();
  };
}

/**
 * HTTP Basic with the developer's own email and password, used only to manage
 * the clients they own. It goes through the same lockout as a normal login.
 */
export function requireAccountOwner(db: Db, config: Config): RequestHandler {
  return async (req, res, next) => {
    const auth = header(req.headers.authorization);
    const challenge = { "WWW-Authenticate": 'Basic realm="lxauth", charset="UTF-8"' };
    if (!auth?.startsWith("Basic ")) {
      next(new HttpError(401, "Unauthorized", challenge));
      return;
    }
    const decoded = Buffer.from(auth.slice(6).trim(), "base64").toString("utf8");
    const colon = decoded.indexOf(":");
    const email = emailField.safeParse(decoded.slice(0, Math.max(colon, 0)));
    const password = passwordField.safeParse(decoded.slice(colon + 1));
    const accountId =
      colon > 0 && email.success && password.success
        ? await authenticate(db, config, email.data, password.data, { ip: req.ip })
        : null;
    if (!accountId) {
      next(new HttpError(401, "Invalid credentials", challenge));
      return;
    }
    res.locals[OWNER_KEY] = accountId;
    next();
  };
}

export function getClient(res: Response): AuthenticatedClient {
  const client = res.locals[CLIENT_KEY] as AuthenticatedClient | undefined;
  if (!client) throw new Error("requireClient must run first");
  return client;
}

export function getSession(res: Response): SessionContext {
  const session = res.locals[SESSION_KEY] as SessionContext | undefined;
  if (!session) throw new Error("requireSession must run first");
  return session;
}

export function getOwner(res: Response): string {
  const owner = res.locals[OWNER_KEY] as string | undefined;
  if (!owner) throw new Error("requireAccountOwner must run first");
  return owner;
}
