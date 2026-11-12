import { getSession, requireClient, requireSession } from "../http/auth.js";
import {
  AcceptInviteBody,
  accessRoleQuery,
  ChangeRoleBody,
  CreateInviteBody,
  CreateOrganizationBody,
  TransferBody,
  UpdateOrganizationBody,
  uuidParam,
} from "../http/validation.js";
import {
  acceptInvite,
  accessDenied,
  changeMemberRole,
  createInvite,
  createOrganization,
  deleteOrganization,
  getOrganization,
  listInvites,
  listMembers,
  listMyOrganizations,
  removeMember,
  revokeInvite,
  roleIn,
  transferOwnership,
  updateOrganization,
} from "../services/organizations.js";
import { atLeast, ORG_ROLES } from "../services/roles.js";
import type { AppContext } from "./context.js";

export function registerOrganizationRoutes({ routes, db }: AppContext): void {
  const auth = [requireClient(db), requireSession(db)];

  routes.add("POST", "/api/v1/organizations", ...auth, async (req, res) => {
    const body = CreateOrganizationBody.parse(req.body);
    const id = await createOrganization(db, getSession(res).accountId, body, req.ip);
    res.status(201).json({ message: "Organization created", id });
  });

  routes.add("GET", "/api/v1/organizations", ...auth, async (_req, res) => {
    res.status(200).json({ organizations: await listMyOrganizations(db, getSession(res).accountId) });
  });

  routes.add("GET", "/api/v1/organizations/:orgId", ...auth, async (req, res) => {
    const org = await getOrganization(db, uuidParam(req.params.orgId), getSession(res).accountId);
    res.status(200).json({ organization: org });
  });

  routes.add("PATCH", "/api/v1/organizations/:orgId", ...auth, async (req, res) => {
    const body = UpdateOrganizationBody.parse(req.body);
    await updateOrganization(db, uuidParam(req.params.orgId), getSession(res).accountId, body, req.ip);
    res.status(200).json({ message: "Organization updated" });
  });

  routes.add("DELETE", "/api/v1/organizations/:orgId", ...auth, async (req, res) => {
    await deleteOrganization(db, uuidParam(req.params.orgId), getSession(res).accountId, req.ip);
    res.status(200).json({ message: "Organization deleted" });
  });

  // Zero-trust check for client apps: a status and a message, nothing else.
  routes.add("GET", "/api/v1/organizations/:orgId/access", ...auth, async (req, res) => {
    const required = accessRoleQuery(req.query.role, ORG_ROLES, "guest");
    const orgId = uuidParam(req.params.orgId);
    const role = await roleIn(db, orgId, getSession(res).accountId);
    if (!role || !atLeast(role, required)) throw accessDenied();
    res.status(200).json({ message: "Access granted" });
  });

  routes.add("GET", "/api/v1/organizations/:orgId/members", ...auth, async (req, res) => {
    const members = await listMembers(db, uuidParam(req.params.orgId), getSession(res).accountId);
    res.status(200).json({ members });
  });

  routes.add("PATCH", "/api/v1/organizations/:orgId/members/:accountId", ...auth, async (req, res) => {
    const body = ChangeRoleBody.parse(req.body);
    await changeMemberRole(
      db,
      uuidParam(req.params.orgId),
      getSession(res).accountId,
      uuidParam(req.params.accountId),
      body.role,
      req.ip,
    );
    res.status(200).json({ message: "Role updated" });
  });

  routes.add("DELETE", "/api/v1/organizations/:orgId/members/:accountId", ...auth, async (req, res) => {
    await removeMember(
      db,
      uuidParam(req.params.orgId),
      getSession(res).accountId,
      uuidParam(req.params.accountId),
      req.ip,
    );
    res.status(200).json({ message: "Member removed" });
  });

  routes.add("POST", "/api/v1/organizations/:orgId/transfer", ...auth, async (req, res) => {
    const body = TransferBody.parse(req.body);
    await transferOwnership(db, uuidParam(req.params.orgId), getSession(res).accountId, body.account_id, req.ip);
    res.status(200).json({ message: "Ownership transferred" });
  });

  routes.add("POST", "/api/v1/organizations/:orgId/invites", ...auth, async (req, res) => {
    const body = CreateInviteBody.parse(req.body);
    const invite = await createInvite(db, uuidParam(req.params.orgId), getSession(res).accountId, body, req.ip);
    res.status(201).json({ message: "Invite created; share the token now, it is not shown again", ...invite });
  });

  routes.add("GET", "/api/v1/organizations/:orgId/invites", ...auth, async (req, res) => {
    const invites = await listInvites(db, uuidParam(req.params.orgId), getSession(res).accountId);
    res.status(200).json({ invites });
  });

  routes.add("DELETE", "/api/v1/organizations/:orgId/invites/:inviteId", ...auth, async (req, res) => {
    await revokeInvite(
      db,
      uuidParam(req.params.orgId),
      getSession(res).accountId,
      uuidParam(req.params.inviteId),
      req.ip,
    );
    res.status(200).json({ message: "Invite revoked" });
  });

  routes.add("POST", "/api/v1/invites/accept", ...auth, async (req, res) => {
    const body = AcceptInviteBody.parse(req.body);
    await acceptInvite(db, getSession(res).accountId, body.invite_token, req.ip);
    res.status(200).json({ message: "Joined the organization" });
  });
}
