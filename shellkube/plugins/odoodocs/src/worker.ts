import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";

type SecretRef = { type: "secret_ref"; secretId: string; version?: number | "latest" };
type Config = { odooUrl: string; odooDb: string; gatewayKey: SecretRef; agentKeys?: Record<string, SecretRef>; docsUrl: string };
type Result = Record<string, unknown> & { status?: string };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ENTITY = "odoo-task";
const MODEL = "project.task";

function uuid(v: unknown, label: string): string {
  const s = typeof v === "string" ? v.trim() : "";
  if (!UUID_RE.test(s)) throw new Error(`${label} must be a uuid`);
  return s;
}
function id(v: unknown, label: string): number {
  const n = Number(v);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`${label} must be a positive integer`);
  return n;
}
const optId = (v: unknown, label: string) => (v === undefined || v === null || v === "" ? undefined : id(v, label));
const text = (v: unknown) => (typeof v === "string" ? v : "");

let host: PluginContext | undefined;

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    host = ctx;
    async function config(companyId: string) {
      const c = (await ctx.config.get(companyId)) as Partial<Config> | null;
      if (!c?.odooUrl || !c.odooDb || !c.gatewayKey) throw new Error("Odoo documents plugin is not configured for this company");
      return c as Config;
    }
    // One JSON-2 call. Odoo's error body carries a traceback (`debug`); only its message goes back.
    async function odoo(c: Config, companyId: string, configPath: string, ref: SecretRef, method: string, body: Record<string, unknown>) {
      const key = await ctx.secrets.resolve(ref, { companyId, configPath });
      const res = await fetch(`${c.odooUrl.replace(/\/$/, "")}/json/2/dms.file/${method}`, {
        method: "POST",
        headers: { Authorization: `bearer ${key}`, "X-Odoo-Database": c.odooDb, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const raw = await res.text();
      let data: unknown;
      try { data = JSON.parse(raw); } catch { data = undefined; }
      if (!res.ok) {
        const msg = (data as { message?: string } | undefined)?.message ?? raw.slice(0, 200);
        throw new Error(`Odoo ${method}: HTTP ${res.status}: ${msg}`);
      }
      return data as Result;
    }
    const gateway = (c: Config, companyId: string, method: string, body: Record<string, unknown>) =>
      odoo(c, companyId, "gatewayKey", c.gatewayKey, method, body);
    function agentCall(c: Config, companyId: string, agentId: string, method: string, body: Record<string, unknown>) {
      const ref = c.agentKeys?.[agentId];
      if (!ref) throw new Error("This agent has no Odoo user (no key in agentKeys)");
      return odoo(c, companyId, `agentKeys.${agentId}`, ref, method, body);
    }

    async function issueIn(issueId: string, companyId: string) {
      if (!(await ctx.issues.get(issueId, companyId))) throw new Error("Task not found in this company");
    }
    // The Odoo task linked to a Paperclip issue (at most one; unlinking marks the entity, the SDK has no delete).
    async function linked(issueId: string, companyId: string, c: Config): Promise<number | null> {
      await issueIn(issueId, companyId);
      const rows = await ctx.entities.list({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId });
      const row = rows.find((r) => r.status === "linked" && r.externalId?.startsWith(`${c.odooDb}:${MODEL}:`));
      return row ? Number(row.data.taskId) : null;
    }
    async function needTask(issueId: string, companyId: string, c: Config) {
      const taskId = await linked(issueId, companyId, c);
      if (!taskId) throw new Error("This Paperclip task is not linked to an Odoo task; link one in the Files tab");
      return taskId;
    }
    async function setLink(issueId: string, c: Config, taskId: number | null) {
      const rows = await ctx.entities.list({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId });
      for (const r of rows) if (r.status === "linked")
        await ctx.entities.upsert({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId, externalId: r.externalId!, title: r.title ?? undefined, status: "unlinked", data: r.data });
      if (taskId) await ctx.entities.upsert({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId,
        externalId: `${c.odooDb}:${MODEL}:${taskId}`, title: `${MODEL} ${taskId}`, status: "linked", data: { model: MODEL, taskId } });
    }

    ctx.data.register("link", async (params) => {
      const companyId = uuid(params.companyId, "companyId"), c = await config(companyId);
      const taskId = await linked(uuid(params.issueId, "issueId"), companyId, c);
      return { taskId, odooUrl: c.odooUrl, docsUrl: c.docsUrl };
    });

    // Person actions: only actions carry the host-verified actor; Odoo checks access as the user with this email.
    function userAction(key: string, fn: (p: Record<string, unknown>, companyId: string, c: Config, login: string) => Promise<unknown>) {
      ctx.actions.register(key, async (params, { actor }) => {
        if (actor.type !== "user" || !actor.userEmail) throw new Error("Only signed-in users with an email can use Odoo files");
        const companyId = uuid(params.companyId, "companyId");
        return fn(params, companyId, await config(companyId), actor.userEmail);
      });
    }
    const list = (c: Config, companyId: string, taskId: number, as_login: string) =>
      gateway(c, companyId, "agent_list", { res_model: MODEL, res_id: taskId, as_login });

    userAction("list", async (p, companyId, c, login) => {
      const taskId = await linked(uuid(p.issueId, "issueId"), companyId, c);
      return taskId ? { taskId, ...(await list(c, companyId, taskId, login)) } : { taskId: null, status: "OK", files: [] };
    });
    userAction("link", async (p, companyId, c, login) => {
      const issueId = uuid(p.issueId, "issueId"), taskId = id(p.taskId, "taskId");
      await issueIn(issueId, companyId);
      const files = await list(c, companyId, taskId, login); // fails when the user cannot see the task
      await setLink(issueId, c, taskId);
      return { taskId, ...files };
    });
    userAction("unlink", async (p, companyId, c) => {
      const issueId = uuid(p.issueId, "issueId");
      await issueIn(issueId, companyId);
      await setLink(issueId, c, null);
      return { taskId: null };
    });
    userAction("upload", async (p, companyId, c, login) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), companyId, c);
      const name = text(p.name).trim();
      if (!name) throw new Error("name is required");
      return gateway(c, companyId, "agent_create", { res_model: MODEL, res_id: taskId, name, content_b64: text(p.contentB64) || null, note: "uploaded from Paperclip", as_login: login });
    });
    userAction("editor-config", async (p, companyId, c, login) =>
      gateway(c, companyId, "oo_editor_config", { ids: [id(p.fileId, "fileId")], mode: p.mode === "view" ? "view" : "edit", as_login: login }));
    userAction("versions", async (p, companyId, c, login) =>
      gateway(c, companyId, "agent_versions", { ids: [id(p.fileId, "fileId")], as_login: login }));

    // Agent tools: each agent calls Odoo with its own bot key, so Odoo checks and audits per agent.
    const out = (r: Result) => ({ content: JSON.stringify(r), data: r });
    const tool = (name: string, fn: (p: Record<string, unknown>, run: { agentId: string; companyId: string }, c: Config) => Promise<Result>) =>
      ctx.tools.register(name, { displayName: name, description: name, parametersSchema: {} }, async (params, run) => {
        try { return out(await fn(params as Record<string, unknown>, run, await config(run.companyId))); }
        catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      });
    tool("doc_list", async (p, run, c) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), run.companyId, c);
      return agentCall(c, run.companyId, run.agentId, "agent_list", { res_model: MODEL, res_id: taskId, query: text(p.query) || null });
    });
    tool("doc_read", (p, run, c) =>
      agentCall(c, run.companyId, run.agentId, "agent_read", { ids: [id(p.fileId, "fileId")], version_id: optId(p.versionId, "versionId") ?? null }));
    tool("doc_write", (p, run, c) => {
      if (!text(p.contentB64)) throw new Error("contentB64 is required");
      return agentCall(c, run.companyId, run.agentId, "agent_write", { ids: [id(p.fileId, "fileId")], content_b64: text(p.contentB64),
        base_version_id: id(p.baseVersionId, "baseVersionId"), note: text(p.note) });
    });
    tool("doc_create", async (p, run, c) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), run.companyId, c);
      if (!text(p.name).trim()) throw new Error("name is required");
      return agentCall(c, run.companyId, run.agentId, "agent_create", { res_model: MODEL, res_id: taskId, name: text(p.name).trim(),
        content_b64: text(p.contentB64) || null, note: text(p.note) });
    });
    tool("doc_comment", (p, run, c) => {
      if (!text(p.body).trim()) throw new Error("body is required");
      return agentCall(c, run.companyId, run.agentId, "agent_comment", { ids: [id(p.fileId, "fileId")], body: text(p.body) });
    });
  },

  // Saving the config installs or updates the managed skill in that company's skill library.
  async onConfigChanged(_config, context) {
    if (context?.companyId) await host?.skills.managed.reconcile("odoo-docs", context.companyId);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
