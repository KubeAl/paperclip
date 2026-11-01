// [shellkube] Pop-up for 403 `agent_restricted` (server/src/services/agent-restriction.ts): an agent-scoped user
// tried to start or steer an agent they may not use. Offer to redo the same request with an allowed agent.
import type { requestResponse as RequestResponse } from "./client";

type Agent = { id: string; name: string };
export type AgentRestriction = { blockedAgentId: string; blockedAgentName: string; allowedAgents: Agent[]; moveIssueId: string | null };

function pickAgent(r: AgentRestriction, blockedName: string): Promise<Agent | null> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = "rounded-lg border border-border bg-background p-5 text-foreground shadow-xl backdrop:bg-black/40 max-w-md";
    const title = document.createElement("h2");
    title.className = "text-base font-semibold";
    title.textContent = r.moveIssueId ? "Move this task?" : "Use another agent?";
    const text = document.createElement("p");
    text.className = "mt-2 text-sm text-muted-foreground";
    const names = r.allowedAgents.map((a) => a.name).join(" or ");
    text.textContent = `${blockedName} is not available to you. As per your approved access, ` +
      (r.moveIssueId ? `this task can only be worked on by ${names}.` : `you can start this with ${names}.`);
    const row = document.createElement("div");
    row.className = "mt-4 flex justify-end gap-2";
    const done = (agent: Agent | null) => { dialog.close(); dialog.remove(); resolve(agent); };
    const cancel = document.createElement("button");
    cancel.className = "rounded-md border border-border px-3 py-1.5 text-sm";
    cancel.textContent = "Cancel";
    cancel.onclick = () => done(null);
    row.append(cancel);
    for (const agent of r.allowedAgents) {
      const button = document.createElement("button");
      button.className = "rounded-md bg-primary px-3 py-1.5 text-sm text-primary-foreground";
      button.textContent = r.moveIssueId ? `Move to ${agent.name}` : `Use ${agent.name}`;
      button.onclick = () => done(agent);
      row.append(button);
    }
    dialog.addEventListener("cancel", () => done(null));
    dialog.append(title, text, row);
    document.body.append(dialog);
    dialog.showModal();
  });
}

export async function offerAllowedAgent(
  request: typeof RequestResponse,
  path: string,
  init: RequestInit | undefined,
  r: AgentRestriction,
): Promise<Response | null> {
  if (typeof document === "undefined" || !r?.allowedAgents?.length) return null;
  const agent = await pickAgent(r, r.blockedAgentName);
  if (!agent) return null;
  if (r.moveIssueId) {
    await request(`/issues/${r.moveIssueId}`, { method: "PATCH", body: JSON.stringify({ assigneeAgentId: agent.id }) });
  }
  const swap = (s: string) => s.split(r.blockedAgentId).join(agent.id);
  const newPath = swap(path).replace(/(\/chats\/)[^/?]+/, `$1${agent.id}`);
  const body = typeof init?.body === "string" ? swap(init.body) : init?.body;
  if (!r.moveIssueId && newPath === path && body === init?.body) return null;
  return request(newPath, { ...init, body });
}
