import { getClient, getSession, requireClient, requireSession } from "../http/auth.js";
import { unauthorized } from "../http/errors.js";
import { limiter } from "../http/rate-limit.js";
import { uuidParam, WalletChallengeBody, WalletSignatureBody } from "../http/validation.js";
import { issueChallenge, linkWallet, listWallets, unlinkWallet, walletLogin } from "../services/wallets.js";
import type { AppContext } from "./context.js";

export function registerWalletRoutes({ routes, db, config, rateLimits }: AppContext): void {
  const client = requireClient(db);
  const session = requireSession(db);
  const authLimit = limiter(rateLimits.auth, 15 * 60 * 1000);

  routes.add("POST", "/api/v1/auth/wallet/challenge", authLimit, client, async (req, res) => {
    const body = WalletChallengeBody.parse(req.body);
    const challenge = await issueChallenge(db, getClient(res), { ...body, purpose: "login" });
    res.status(200).json({
      message: "Sign siwe_message with the wallet (personal_sign)",
      siwe_message: challenge.message,
      expires_at: challenge.expires_at,
    });
  });

  routes.add("POST", "/api/v1/auth/wallet/login", authLimit, client, async (req, res) => {
    const body = WalletSignatureBody.parse(req.body);
    const token = await walletLogin(db, config, getClient(res), body, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    if (!token) throw unauthorized("Invalid credentials");
    res.status(200).json({ message: "Login successful", session_token: token });
  });

  routes.add("GET", "/api/v1/account/wallets", client, session, async (_req, res) => {
    res.status(200).json({ wallets: await listWallets(db, getSession(res).accountId) });
  });

  routes.add("POST", "/api/v1/account/wallets/challenge", client, session, async (req, res) => {
    const body = WalletChallengeBody.parse(req.body);
    const challenge = await issueChallenge(db, getClient(res), {
      ...body,
      purpose: "link",
      sessionId: getSession(res).sessionId,
    });
    res.status(200).json({
      message: "Sign siwe_message with the wallet (personal_sign)",
      siwe_message: challenge.message,
      expires_at: challenge.expires_at,
    });
  });

  routes.add("POST", "/api/v1/account/wallets", client, session, async (req, res) => {
    const body = WalletSignatureBody.parse(req.body);
    const id = await linkWallet(db, getSession(res), body, req.ip);
    res.status(201).json({ message: "Wallet linked", id });
  });

  routes.add("DELETE", "/api/v1/account/wallets/:walletId", client, session, async (req, res) => {
    await unlinkWallet(db, getSession(res), uuidParam(req.params.walletId), req.ip);
    res.status(200).json({ message: "Wallet unlinked" });
  });
}
