import type { AppContext } from "./context.js";
import { getClient, getOwner, getSession, requireAccountOwner, requireClient, requireSession } from "../http/auth.js";
import { limiter } from "../http/rate-limit.js";
import {
  AddEmailBody,
  ChangePasswordBody,
  CreateClientBody,
  DeleteAccountBody,
  LoginBody,
  RegisterBody,
  UpdateClientBody,
  UpdateEmailBody,
  uuidParam,
} from "../http/validation.js";
import { authenticate, changePassword, deleteAccount, registerAccount } from "../services/accounts.js";
import { createClient, listClients, revokeClient, rotateClientSecret, updateClient } from "../services/clients.js";
import { addEmail, listEmails, removeEmail, updateEmail } from "../services/emails.js";
import { createSession, listSessions, revokeOtherSessions, revokeSession } from "../services/sessions.js";
import { notFound, unauthorized } from "../http/errors.js";
import { z } from "zod";

const clientIdParam = z.string().regex(/^lxc_[A-Za-z0-9_-]{22}$/);

function publicClientId(value: string | string[] | undefined): string {
  const parsed = clientIdParam.safeParse(value);
  if (!parsed.success) throw notFound();
  return parsed.data;
}

export function registerAccountRoutes({ routes, db, config, rateLimits }: AppContext): void {
  const client = requireClient(db);
  const session = requireSession(db);
  const owner = requireAccountOwner(db, config);
  const authLimit = limiter(rateLimits.auth, 15 * 60 * 1000);
  const registerLimit = limiter(rateLimits.register, 60 * 60 * 1000);

  // ---- Accounts -----------------------------------------------------------

  routes.add("POST", "/api/v1/accounts", registerLimit, async (req, res) => {
    const body = RegisterBody.parse(req.body);
    await registerAccount(db, body.email, body.password, req.ip);
    res.status(201).json({ message: "Account created" });
  });

  routes.add("DELETE", "/api/v1/account", client, session, async (req, res) => {
    const body = DeleteAccountBody.parse(req.body);
    await deleteAccount(db, getSession(res).accountId, body.password, req.ip);
    res.status(200).json({ message: "Account deleted" });
  });

  routes.add("PUT", "/api/v1/account/password", client, session, async (req, res) => {
    const body = ChangePasswordBody.parse(req.body);
    const s = getSession(res);
    await changePassword(db, s.accountId, s.sessionId, body.current_password, body.new_password, req.ip);
    res.status(200).json({ message: "Password changed; other sessions were signed out" });
  });

  // ---- Account emails -----------------------------------------------------

  routes.add("GET", "/api/v1/account/emails", client, session, async (_req, res) => {
    res.status(200).json({ emails: await listEmails(db, getSession(res).accountId) });
  });

  routes.add("POST", "/api/v1/account/emails", client, session, async (req, res) => {
    const body = AddEmailBody.parse(req.body);
    const id = await addEmail(db, getSession(res).accountId, body, req.ip);
    res.status(201).json({ message: "Email added", id });
  });

  routes.add("PATCH", "/api/v1/account/emails/:emailId", client, session, async (req, res) => {
    const id = uuidParam(req.params.emailId);
    const body = UpdateEmailBody.parse(req.body);
    await updateEmail(db, getSession(res).accountId, id, body, req.ip);
    res.status(200).json({ message: "Email updated" });
  });

  routes.add("DELETE", "/api/v1/account/emails/:emailId", client, session, async (req, res) => {
    const id = uuidParam(req.params.emailId);
    await removeEmail(db, getSession(res).accountId, id, req.ip);
    res.status(200).json({ message: "Email removed" });
  });

  // ---- Login and sessions -------------------------------------------------

  routes.add("POST", "/api/v1/auth/login", authLimit, client, async (req, res) => {
    const body = LoginBody.parse(req.body);
    const c = getClient(res);
    const accountId = await authenticate(db, config, body.email, body.password, { clientId: c.id, ip: req.ip });
    if (!accountId) throw unauthorized("Invalid credentials");
    const token = await createSession(db, config, accountId, c.id, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    // Deliberately no account data: the token is the only thing a client gets.
    res.status(200).json({ message: "Login successful", session_token: token });
  });

  routes.add("GET", "/api/v1/auth/session", client, session, (_req, res) => {
    res.status(200).json({ message: "Session is valid" });
  });

  routes.add("POST", "/api/v1/auth/logout", client, session, async (req, res) => {
    const s = getSession(res);
    await revokeSession(db, s, s.sessionId, req.ip);
    res.status(200).json({ message: "Logged out" });
  });

  routes.add("GET", "/api/v1/sessions", client, session, async (_req, res) => {
    res.status(200).json({ sessions: await listSessions(db, getSession(res)) });
  });

  routes.add("DELETE", "/api/v1/sessions", client, session, async (req, res) => {
    const count = await revokeOtherSessions(db, getSession(res), req.ip);
    res.status(200).json({ message: `Signed out ${count} other session(s)` });
  });

  routes.add("DELETE", "/api/v1/sessions/:sessionId", client, session, async (req, res) => {
    const id = uuidParam(req.params.sessionId);
    await revokeSession(db, getSession(res), id, req.ip);
    res.status(200).json({ message: "Session revoked" });
  });

  // ---- Clients (managed with the developer's own email and password) -----

  routes.add("POST", "/api/v1/clients", authLimit, owner, async (req, res) => {
    const body = CreateClientBody.parse(req.body);
    const created = await createClient(db, getOwner(res), body, req.ip);
    res.status(201).json({ message: "Client created; store the secret now, it is not shown again", ...created });
  });

  routes.add("GET", "/api/v1/clients", authLimit, owner, async (_req, res) => {
    res.status(200).json({ clients: await listClients(db, getOwner(res)) });
  });

  routes.add("PATCH", "/api/v1/clients/:clientId", authLimit, owner, async (req, res) => {
    const body = UpdateClientBody.parse(req.body);
    await updateClient(db, getOwner(res), publicClientId(req.params.clientId), body, req.ip);
    res.status(200).json({ message: "Client updated" });
  });

  routes.add("POST", "/api/v1/clients/:clientId/secret", authLimit, owner, async (req, res) => {
    const rotated = await rotateClientSecret(db, getOwner(res), publicClientId(req.params.clientId), req.ip);
    res.status(200).json({ message: "Secret rotated; store it now, it is not shown again", ...rotated });
  });

  routes.add("DELETE", "/api/v1/clients/:clientId", authLimit, owner, async (req, res) => {
    await revokeClient(db, getOwner(res), publicClientId(req.params.clientId), req.ip);
    res.status(200).json({ message: "Client revoked" });
  });
}
