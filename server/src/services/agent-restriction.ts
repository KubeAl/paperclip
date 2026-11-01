import type { RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import type { Db } from "@paperclipai/db";
import { agents, heartbeatRuns, issues, principalPermissionGrants, routines } from "@paperclipai/db";
import { forbidden } from "../errors.js";
import { agentService } from "./agents.js";

// [shellkube] Agent-scoped principals. A user or agent whose `tasks:assign` grant is scoped to
// `agentIds` may only start, wake or steer those agents. Everyone else is unrestricted.
// A blocked request returns 403 code `agent_restricted`; the UI offers to redo it with an allowed agent.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

export async function allowedAgentIds(
  db: Db,
  companyId: string,
  principalType: "user" | "agent",
  principalId: string,
): Promise<string[] | null> {
  const grant = await db
    .select({ scope: principalPermissionGrants.scope })
    .from(principalPermissionGrants)
    .where(and(
      eq(principalPermissionGrants.companyId, companyId),
      eq(principalPermissionGrants.principalType, principalType),
      eq(principalPermissionGrants.principalId, principalId),
      eq(principalPermissionGrants.permissionKey, "tasks:assign"),
    ))
    .then((rows) => rows[0] ?? null);
  const ids = (grant?.scope as { agentIds?: unknown } | null)?.agentIds;
  return Array.isArray(ids) && ids.length > 0 ? ids.map(String) : null;
}

async function agentRestricted(db: Db, companyId: string, blockedAgentId: string, allowed: string[], moveIssueId?: string) {
  const rows = await db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(inArray(agents.id, [blockedAgentId, ...allowed]));
  const name = (id: string) => rows.find((row) => row.id === id)?.name ?? id;
  const allowedNames = allowed.map(name).join(", ");
  return forbidden(`You can only work with ${allowedNames}, not ${name(blockedAgentId)}.`, {
    code: "agent_restricted",
    agentRestriction: {
      companyId,
      blockedAgentId,
      blockedAgentName: name(blockedAgentId),
      allowedAgents: allowed.map((id) => ({ id, name: name(id) })),
      moveIssueId: moveIssueId ?? null,
    },
  });
}

type Principal = { type: "user" | "agent"; id: string; companyIds: string[] | null };

function principalOf(req: Parameters<RequestHandler>[0]): Principal | null {
  const actor = req.actor;
  if (actor.type === "agent" && actor.agentId) return { type: "agent", id: actor.agentId, companyIds: actor.companyId ? [actor.companyId] : [] };
  if (actor.type === "board" && actor.userId && actor.source !== "local_implicit" && !actor.isInstanceAdmin) {
    return { type: "user", id: actor.userId, companyIds: actor.companyIds ?? [] };
  }
  return null;
}

export function agentRestrictionGuard(db: Db): RequestHandler {
  return (req, _res, next) => {
    if (SAFE.has(req.method.toUpperCase())) return next();
    const principal = principalOf(req);
    if (!principal) return next();
    check(db, req, principal).then(() => next(), next);
  };
}

async function check(db: Db, req: Parameters<RequestHandler>[0], principal: Principal) {
  const scopeFor = (companyId: string) => allowedAgentIds(db, companyId, principal.type, principal.id);
  const parts = req.path.split("/").filter(Boolean);
  const body = (req.body ?? {}) as Record<string, unknown>;

  // Marking a task read/unread is a view action; the UI sends it on every task page.
  if (parts[0] === "issues" && parts[1] && !(parts.length === 3 && parts[2] === "read")) {
    const ref = parts[1];
    const issue = await db
      .select({
        id: issues.id,
        companyId: issues.companyId,
        assigneeAgentId: issues.assigneeAgentId,
        createdByUserId: issues.createdByUserId,
        createdByAgentId: issues.createdByAgentId,
      })
      .from(issues)
      .where(UUID.test(ref) ? eq(issues.id, ref) : eq(issues.identifier, ref.toUpperCase()))
      .then((rows) => rows[0] ?? null);
    if (issue?.assigneeAgentId) {
      const allowed = await scopeFor(issue.companyId);
      if (allowed && !allowed.includes(issue.assigneeAgentId)) {
        const ownTask = principal.type === "user" ? issue.createdByUserId === principal.id : issue.createdByAgentId === principal.id;
        // The one write allowed on a task started with the wrong agent: its creator moving it to an allowed agent.
        const isMove = parts.length === 2 && req.method.toUpperCase() === "PATCH"
          && typeof body.assigneeAgentId === "string" && allowed.includes(body.assigneeAgentId)
          && Object.keys(body).every((key) => key === "assigneeAgentId" || key === "assigneeUserId");
        if (!(ownTask && isMove)) {
          throw await agentRestricted(db, issue.companyId, issue.assigneeAgentId, allowed, ownTask ? issue.id : undefined);
        }
      }
    }
  }

  if (parts[0] === "agents" && parts[1]) {
    await checkAgent(parts[1]);
  }
  if (parts[0] === "companies" && parts[2] === "chats" && parts[3]) {
    const { agent } = await agentService(db).resolveByReference(parts[1], decodeURIComponent(parts[3]));
    if (agent) await checkAgent(agent.id);
  }
  if (parts[0] === "routines" && parts[1] && UUID.test(parts[1])) {
    const routine = await db.select({ agentId: routines.assigneeAgentId }).from(routines).where(eq(routines.id, parts[1])).then((rows) => rows[0] ?? null);
    if (routine?.agentId) await checkAgent(routine.agentId);
  }
  if (parts[0] === "heartbeat-runs" && parts[1] && UUID.test(parts[1])) {
    const run = await db.select({ agentId: heartbeatRuns.agentId }).from(heartbeatRuns).where(eq(heartbeatRuns.id, parts[1])).then((rows) => rows[0] ?? null);
    if (run) await checkAgent(run.agentId);
  }
  if (parts[0] === "approvals") {
    // Board approvals (agent hires, budgets) are not for agent-scoped principals.
    for (const companyId of principal.companyIds ?? []) {
      if (await scopeFor(companyId)) throw forbidden("Approvals need a full company member.");
    }
  }
  if (typeof body.assigneeAgentId === "string" && !(parts[0] === "issues" && parts.length === 2)) {
    await checkAgent(body.assigneeAgentId);
  }

  async function checkAgent(agentRef: string) {
    if (!UUID.test(agentRef)) {
      for (const companyId of principal.companyIds ?? []) {
        const { agent } = await agentService(db).resolveByReference(companyId, decodeURIComponent(agentRef));
        if (agent) return checkAgent(agent.id);
      }
      return;
    }
    const agent = await db.select({ companyId: agents.companyId }).from(agents).where(eq(agents.id, agentRef)).then((rows) => rows[0] ?? null);
    if (!agent) return;
    const allowed = await scopeFor(agent.companyId);
    if (allowed && !allowed.includes(agentRef)) throw await agentRestricted(db, agent.companyId, agentRef, allowed);
  }
}
