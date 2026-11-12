import { getSession, requireClient, requireSession } from "../http/auth.js";
import { HttpError } from "../http/errors.js";
import { accessRoleQuery, CreateTeamBody, PutTeamMemberBody, UpdateTeamBody, uuidParam } from "../http/validation.js";
import {
  createTeam,
  deleteTeam,
  getTeam,
  hasTeamAccess,
  listTeamMembers,
  listTeams,
  putTeamMember,
  removeTeamMember,
  TEAM_ROLES,
  updateTeam,
} from "../services/teams.js";
import type { AppContext } from "./context.js";

export function registerTeamRoutes({ routes, db }: AppContext): void {
  const auth = [requireClient(db), requireSession(db)];

  routes.add("POST", "/api/v1/organizations/:orgId/teams", ...auth, async (req, res) => {
    const body = CreateTeamBody.parse(req.body);
    const id = await createTeam(db, uuidParam(req.params.orgId), getSession(res).accountId, body, req.ip);
    res.status(201).json({ message: "Team created", id });
  });

  routes.add("GET", "/api/v1/organizations/:orgId/teams", ...auth, async (req, res) => {
    res.status(200).json({ teams: await listTeams(db, uuidParam(req.params.orgId), getSession(res).accountId) });
  });

  routes.add("GET", "/api/v1/teams/:teamId", ...auth, async (req, res) => {
    res.status(200).json({ team: await getTeam(db, uuidParam(req.params.teamId), getSession(res).accountId) });
  });

  routes.add("PATCH", "/api/v1/teams/:teamId", ...auth, async (req, res) => {
    const body = UpdateTeamBody.parse(req.body);
    await updateTeam(db, uuidParam(req.params.teamId), getSession(res).accountId, body, req.ip);
    res.status(200).json({ message: "Team updated" });
  });

  routes.add("DELETE", "/api/v1/teams/:teamId", ...auth, async (req, res) => {
    await deleteTeam(db, uuidParam(req.params.teamId), getSession(res).accountId, req.ip);
    res.status(200).json({ message: "Team deleted" });
  });

  // Zero-trust check for client apps: a status and a message, nothing else.
  routes.add("GET", "/api/v1/teams/:teamId/access", ...auth, async (req, res) => {
    const required = accessRoleQuery(req.query.role, TEAM_ROLES, "member");
    const ok = await hasTeamAccess(db, uuidParam(req.params.teamId), getSession(res).accountId, required);
    if (!ok) throw new HttpError(403, "Access denied");
    res.status(200).json({ message: "Access granted" });
  });

  routes.add("GET", "/api/v1/teams/:teamId/members", ...auth, async (req, res) => {
    res.status(200).json({ members: await listTeamMembers(db, uuidParam(req.params.teamId), getSession(res).accountId) });
  });

  routes.add("PUT", "/api/v1/teams/:teamId/members/:accountId", ...auth, async (req, res) => {
    const body = PutTeamMemberBody.parse(req.body ?? {});
    const outcome = await putTeamMember(
      db,
      uuidParam(req.params.teamId),
      getSession(res).accountId,
      uuidParam(req.params.accountId),
      body.role,
      req.ip,
    );
    res.status(outcome === "added" ? 201 : 200).json({ message: outcome === "added" ? "Member added" : "Role updated" });
  });

  routes.add("DELETE", "/api/v1/teams/:teamId/members/:accountId", ...auth, async (req, res) => {
    await removeTeamMember(
      db,
      uuidParam(req.params.teamId),
      getSession(res).accountId,
      uuidParam(req.params.accountId),
      req.ip,
    );
    res.status(200).json({ message: "Member removed" });
  });
}
