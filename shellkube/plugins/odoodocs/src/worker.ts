import { createHmac, timingSafeEqual } from "node:crypto";
import { definePlugin, runWorker, type PluginContext, type PluginWebhookInput } from "@paperclipai/plugin-sdk";

type SecretRef = { type: "secret_ref"; secretId: string; version?: number | "latest" };
type Config = { odooUrl: string; odooDb: string; gatewayKey: SecretRef; agentKeys?: Record<string, SecretRef>; docsUrl: string; webhookSecret?: SecretRef };
type Result = Record<string, unknown> & { status?: string };
// Odoo -> Paperclip webhook body (CONTRACT "Live updates").
type OdooEvent = { event: string; db: string; res_model: string; res_id: number; file_id: number; name?: string; version?: number;
  author_name?: string; editors?: Array<{ id: number; name: string }> };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const ENTITY = "odoo-task";
const MODEL = "project.task";
const KEY_TTL_MS = 10 * 60_000;

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
const template = (p: Record<string, unknown>) => (p.templateId ? { template_id: id(p.templateId, "templateId") } : {});
const text = (v: unknown) => (typeof v === "string" ? v : "");
const orNull = (v: unknown) => text(v).trim() || null;
function need(v: unknown, label: string) {
  const s = text(v).trim();
  if (!s) throw new Error(`${label} is required`);
  return s;
}
export function sign(body: string, secret: string) {
  return "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
}
function signedBy(body: string, secret: string, header: unknown) {
  const want = Buffer.from(sign(body, secret)), got = Buffer.from(String(header ?? ""));
  return want.length === got.length && timingSafeEqual(want, got);
}

let host: PluginContext | undefined;
let receive: ((input: PluginWebhookInput) => Promise<void>) | undefined;
// Odoo API keys, cached so open Files tabs stay under the host's limit of 30 secret lookups per minute per company.
// shortcut: a rotated key is picked up after 10 min or on the first 401, never written anywhere.
const keys = new Map<string, { value: Promise<string>; until: number }>();

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    host = ctx;
    async function config(companyId: string) {
      const c = (await ctx.config.get(companyId)) as Partial<Config> | null;
      if (!c?.odooUrl || !c.odooDb || !c.gatewayKey) throw new Error("Odoo documents plugin is not configured for this company");
      return c as Config;
    }
    function secret(ref: SecretRef, companyId: string, configPath: string) {
      const k = `${companyId}:${ref.secretId}:${ref.version ?? "latest"}`;
      const hit = keys.get(k);
      if (hit && hit.until > Date.now()) return { k, value: hit.value };
      const value = ctx.secrets.resolve(ref, { companyId, configPath });
      keys.set(k, { value, until: Date.now() + KEY_TTL_MS });
      value.catch(() => keys.delete(k));
      return { k, value };
    }
    // One JSON-2 call. Odoo's error body carries a traceback (`debug`); only its message goes back.
    async function odoo(c: Config, companyId: string, configPath: string, ref: SecretRef, method: string, body: Record<string, unknown>) {
      const key = secret(ref, companyId, configPath);
      const res = await fetch(`${c.odooUrl.replace(/\/$/, "")}/json/2/dms.file/${method}`, {
        method: "POST",
        headers: { Authorization: `bearer ${await key.value}`, "X-Odoo-Database": c.odooDb, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) keys.delete(key.k);
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
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error("Task not found in this company");
      return issue;
    }
    const links = (issueId: string) => ctx.entities.list({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId });
    // The Odoo task linked to a Paperclip issue (at most one; unlinking marks the entity, the SDK has no delete).
    async function linked(issueId: string, companyId: string, c: Config): Promise<number | null> {
      await issueIn(issueId, companyId);
      const row = (await links(issueId)).find((r) => r.status === "linked" && r.externalId?.startsWith(`${c.odooDb}:${MODEL}:`));
      return row ? Number(row.data.taskId) : null;
    }
    async function needTask(issueId: string, companyId: string, c: Config) {
      const taskId = await linked(issueId, companyId, c);
      if (!taskId) throw new Error("This Paperclip task is not linked to an Odoo task; link one in the Odoo files tab");
      return taskId;
    }
    async function setLink(issueId: string, companyId: string, c: Config, taskId: number | null) {
      for (const r of await links(issueId)) if (r.status === "linked")
        await ctx.entities.upsert({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId, externalId: r.externalId!, title: r.title ?? undefined, status: "unlinked", data: r.data });
      if (taskId) await ctx.entities.upsert({ entityType: ENTITY, scopeKind: "issue", scopeId: issueId,
        externalId: `${c.odooDb}:${MODEL}:${taskId}`, title: `${MODEL} ${taskId}`, status: "linked", data: { model: MODEL, taskId, companyId } });
    }

    ctx.data.register("link", async (params) => {
      const companyId = uuid(params.companyId, "companyId"), c = await config(companyId);
      const taskId = await linked(uuid(params.issueId, "issueId"), companyId, c);
      return { taskId, odooUrl: c.odooUrl, docsUrl: c.docsUrl };
    });
    // Agents that have an Odoo user, for "Ask an agent".
    ctx.data.register("agents", async (params) => {
      const companyId = uuid(params.companyId, "companyId"), c = await config(companyId);
      const all = await ctx.agents.list({ companyId });
      return all.filter((a) => c.agentKeys?.[a.id] && a.status !== "terminated").map((a) => ({ id: a.id, name: a.name }));
    });

    // Person actions: only actions carry the host-verified actor; Odoo checks access as the user with this email.
    type Person = { login: string; userId: string };
    function userAction(key: string, fn: (p: Record<string, unknown>, companyId: string, c: Config, login: string, user: Person) => Promise<unknown>) {
      ctx.actions.register(key, async (params, { actor }) => {
        if (actor.type !== "user" || !actor.userEmail || !actor.userId) throw new Error("Only signed-in users with an email can use Odoo files");
        const companyId = uuid(params.companyId, "companyId");
        return fn(params, companyId, await config(companyId), actor.userEmail, { login: actor.userEmail, userId: actor.userId });
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
      await setLink(issueId, companyId, c, taskId);
      return { taskId, ...files };
    });
    userAction("unlink", async (p, companyId, c) => {
      const issueId = uuid(p.issueId, "issueId");
      await issueIn(issueId, companyId);
      await setLink(issueId, companyId, c, null);
      return { taskId: null };
    });
    // Upload (contentB64), blank (.docx/.xlsx/.pptx name) or from a template (templateId).
    userAction("create", async (p, companyId, c, login) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), companyId, c);
      return gateway(c, companyId, "agent_create", { res_model: MODEL, res_id: taskId, name: need(p.name, "name"),
        content_b64: text(p.contentB64) || null, ...template(p), note: text(p.note) || "from Paperclip", as_login: login });
    });
    // A new version as the person (the live panel's "Save to Odoo task").
    userAction("write", async (p, companyId, c, login) =>
      gateway(c, companyId, "agent_write", { ids: [id(p.fileId, "fileId")], content_b64: need(p.contentB64, "contentB64"),
        base_version_id: id(p.baseVersionId, "baseVersionId"), note: text(p.note) || "from Paperclip", as_login: login }));
    userAction("templates", (_p, companyId, c, login) => gateway(c, companyId, "agent_templates", { as_login: login }));
    userAction("editor-config", async (p, companyId, c, login) =>
      gateway(c, companyId, "oo_editor_config", { ids: [id(p.fileId, "fileId")], mode: p.mode === "view" ? "view" : "edit", as_login: login }));
    userAction("versions", async (p, companyId, c, login) =>
      gateway(c, companyId, "agent_versions", { ids: [id(p.fileId, "fileId")], as_login: login }));
    userAction("export-pdf", async (p, companyId, c, login) =>
      gateway(c, companyId, "agent_export_pdf", { ids: [id(p.fileId, "fileId")], as_login: login }));
    userAction("share", async (p, companyId, c, login) =>
      gateway(c, companyId, "agent_share", { ids: [id(p.fileId, "fileId")], expires: orNull(p.expires), password: orNull(p.password), as_login: login }));
    userAction("request", async (p, companyId, c, login) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), companyId, c);
      return gateway(c, companyId, "agent_request", requestBody(p, taskId, login));
    });
    // "Ask an agent" about one file: the task goes to that agent and the person's comment (naming the file) wakes it.
    userAction("ask", async (p, companyId, c, _login, user) => {
      const issueId = uuid(p.issueId, "issueId"), agentId = uuid(p.agentId, "agentId"), fileId = id(p.fileId, "fileId");
      const request = need(p.request, "request");
      if (!c.agentKeys?.[agentId]) throw new Error("This agent has no Odoo user (no key in agentKeys)");
      const [issue, agent] = await Promise.all([issueIn(issueId, companyId), ctx.agents.get(agentId, companyId)]);
      if (!agent) throw new Error("Agent not found in this company");
      const status = ["backlog", "done", "cancelled"].includes(issue.status) ? "todo" : issue.status;
      if (issue.assigneeAgentId !== agentId || status !== issue.status)
        await ctx.issues.update(issueId, { assigneeAgentId: agentId, assigneeUserId: null, status }, companyId, { actorUserId: user.userId });
      const file = `**${text(p.name) || `file ${fileId}`}** (Odoo file ${fileId}, v${Number(p.version) || "?"}, version_id ${optId(p.versionId, "versionId") ?? "?"})`;
      const body = `@${agent.name} ${request}\n\nFile: ${file}. Use \`odoo-docs\` (read it, write with \`--base\` and a \`--note\`).`;
      const comment = await ctx.issues.createComment(issueId, body, companyId, { actorUserId: user.userId });
      return { ok: true, commentId: comment.id };
    });

    function requestBody(p: Record<string, unknown>, taskId: number, as_login: string | null) {
      const user_login = orNull(p.userLogin), partner_email = orNull(p.partnerEmail);
      if (!user_login === !partner_email) throw new Error("Give a user login or a partner email (one of them)");
      return { res_model: MODEL, res_id: taskId, name: need(p.name, "name"), user_login, partner_email,
        deadline: orNull(p.deadline), note: text(p.note), ...(as_login ? { as_login } : {}) };
    }

    // ---- Agent tools: each agent calls Odoo with its own bot key, so Odoo checks and audits per agent. ----
    type Run = { agentId: string; companyId: string };
    const out = (r: Result) => ({ content: JSON.stringify(r), data: r });
    const tool = (name: string, fn: (p: Record<string, unknown>, run: Run, c: Config) => Promise<Result>) =>
      ctx.tools.register(name, { displayName: name, description: name, parametersSchema: {} }, async (params, run) => {
        try { return out(await fn(params as Record<string, unknown>, run, await config(run.companyId))); }
        catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
      });
    const waitKey = (issueId: string) => ({ scopeKind: "issue" as const, scopeId: issueId, stateKey: "lock-waits" });
    type Waits = Record<string, string[]>; // file id -> agent ids that got LOCKED

    // A compact line in the task thread for each agent save (attributed to the agent; agent comments wake nobody).
    // Never fails the tool: the version is saved, and an error here would make the agent save it again.
    async function saved(issueId: string, run: Run, c: Config, fileId: number, version: unknown, note: string) {
      try { await savedLine(issueId, run, c, fileId, version, note); }
      catch (e) { ctx.logger.warn("could not post the save line", { issueId, fileId, error: String(e) }); }
    }
    async function savedLine(issueId: string, run: Run, c: Config, fileId: number, version: unknown, note: string) {
      const taskId = await needTask(issueId, run.companyId, c);
      const files = (await agentCall(c, run.companyId, run.agentId, "agent_list", { res_model: MODEL, res_id: taskId })).files as Array<{ id: number; name: string }>;
      const name = files?.find((f) => f.id === fileId)?.name ?? `file ${fileId}`;
      const open = `${c.odooUrl.replace(/\/$/, "")}/shellkube_dms/oo/editor/${fileId}`;
      await ctx.issues.createComment(issueId, `Saved **${name}** v${version} in Odoo${note ? `: ${note}` : ""} · [Open](${open})`,
        run.companyId, { authorAgentId: run.agentId });
    }

    tool("doc_list", async (p, run, c) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), run.companyId, c);
      return agentCall(c, run.companyId, run.agentId, "agent_list", { res_model: MODEL, res_id: taskId, query: text(p.query) || null });
    });
    tool("doc_read", (p, run, c) =>
      agentCall(c, run.companyId, run.agentId, "agent_read", { ids: [id(p.fileId, "fileId")], version_id: optId(p.versionId, "versionId") ?? null }));
    tool("doc_write", async (p, run, c) => {
      const fileId = id(p.fileId, "fileId"), issueId = p.issueId ? uuid(p.issueId, "issueId") : undefined, note = text(p.note);
      const r = await agentCall(c, run.companyId, run.agentId, "agent_write", { ids: [fileId], content_b64: need(p.contentB64, "contentB64"),
        base_version_id: id(p.baseVersionId, "baseVersionId"), note });
      if (issueId && r.status === "OK") await saved(issueId, run, c, fileId, r.version, note);
      if (issueId && r.status === "LOCKED") {
        await issueIn(issueId, run.companyId);
        const waits = ((await ctx.state.get(waitKey(issueId))) ?? {}) as Waits;
        waits[fileId] = [...new Set([...(waits[fileId] ?? []), run.agentId])];
        await ctx.state.set(waitKey(issueId), waits);
        return { ...r, next: "Stop here and end your run; say in your comment that the file is locked. You are woken on this task when it is free." };
      }
      return r;
    });
    tool("doc_create", async (p, run, c) => {
      const issueId = uuid(p.issueId, "issueId"), taskId = await needTask(issueId, run.companyId, c), note = text(p.note);
      const r = await agentCall(c, run.companyId, run.agentId, "agent_create", { res_model: MODEL, res_id: taskId, name: need(p.name, "name"),
        content_b64: text(p.contentB64) || null, ...template(p), note });
      if (r.status === "OK") await saved(issueId, run, c, Number(r.id), r.version, note);
      return r;
    });
    tool("doc_comment", (p, run, c) =>
      agentCall(c, run.companyId, run.agentId, "agent_comment", { ids: [id(p.fileId, "fileId")], body: need(p.body, "body") }));
    tool("doc_templates", (_p, run, c) => agentCall(c, run.companyId, run.agentId, "agent_templates", {}));
    tool("doc_export_pdf", (p, run, c) => agentCall(c, run.companyId, run.agentId, "agent_export_pdf", { ids: [id(p.fileId, "fileId")] }));
    tool("doc_share", (p, run, c) =>
      agentCall(c, run.companyId, run.agentId, "agent_share", { ids: [id(p.fileId, "fileId")], expires: orNull(p.expires), password: orNull(p.password) }));
    tool("doc_request", async (p, run, c) => {
      const taskId = await needTask(uuid(p.issueId, "issueId"), run.companyId, c);
      return agentCall(c, run.companyId, run.agentId, "agent_request", requestBody(p, taskId, null));
    });

    // ---- Odoo webhook: push to open Files tabs; wake agents that waited for a locked file. ----
    const opened = new Set<string>();
    function push(issueId: string, companyId: string, ev: OdooEvent) {
      const ch = `files:${issueId}`;
      if (!opened.has(ch)) { ctx.streams.open(ch, companyId); opened.add(ch); }
      ctx.streams.emit(ch, { event: ev.event, fileId: ev.file_id });
    }
    async function wakeWaiters(issueId: string, companyId: string, ev: OdooEvent) {
      const waits = ((await ctx.state.get(waitKey(issueId))) ?? {}) as Waits;
      const agentIds = waits[ev.file_id];
      if (!agentIds?.length) return;
      delete waits[ev.file_id];
      await ctx.state.set(waitKey(issueId), waits);
      const [issue, agents] = await Promise.all([issueIn(issueId, companyId),
        Promise.all(agentIds.map((a) => ctx.agents.get(a, companyId)))]);
      const names = agents.filter(Boolean).map((a) => `@${a!.name}`).join(" ");
      const body = `${names} **${ev.name ?? `File ${ev.file_id}`}** is free again: v${ev.version} by ${ev.author_name ?? "?"}. ` +
        `Read it again (\`odoo-docs read ${ev.file_id}\`) and redo your change on it.`;
      await ctx.issues.createComment(issueId, body, companyId);
      for (const agentId of agentIds) {
        try {
          if (issue.assigneeAgentId === agentId)
            await ctx.issues.requestWakeup(issueId, companyId, { reason: "odoo_file_unlocked", idempotencyKey: `odoo-free:${issueId}:${ev.file_id}:${ev.version}` });
          else await ctx.agents.invoke(agentId, companyId, { prompt: `${body} (Paperclip task ${issue.identifier})`, reason: "odoo_file_unlocked" });
        } catch (e) { ctx.logger.warn("could not wake agent for a free Odoo file", { agentId, issueId, error: String(e) }); }
      }
    }
    receive = async ({ headers, rawBody }) => {
      const ev = JSON.parse(rawBody) as OdooEvent;
      if (ev.res_model !== MODEL) return;
      const rows = (await ctx.entities.list({ entityType: ENTITY, externalId: `${ev.db}:${MODEL}:${ev.res_id}` }))
        .filter((r) => r.status === "linked" && r.scopeId && typeof r.data.companyId === "string");
      let verified = !rows.length;
      for (const companyId of new Set(rows.map((r) => r.data.companyId as string))) {
        const c = await config(companyId);
        if (!c.webhookSecret || !signedBy(rawBody, await secret(c.webhookSecret, companyId, "webhookSecret").value, headers["x-shellkube-signature"])) continue;
        verified = true;
        for (const r of rows.filter((r) => r.data.companyId === companyId)) {
          push(r.scopeId!, companyId, ev);
          // A save while the editor stays open (force-save) keeps the lock: wake only when nobody edits.
          if ((ev.event === "unlocked" || ev.event === "version") && !ev.editors?.length) await wakeWaiters(r.scopeId!, companyId, ev);
        }
      }
      if (!verified) throw new Error("bad signature");
    };
  },

  async onWebhook(input) {
    await receive!(input);
  },

  // Saving the config (re)installs the managed skill from this build into that company's skill library.
  async onConfigChanged(_config, context) {
    keys.clear();
    if (context?.companyId) await host?.skills.managed.reset("odoo-docs", context.companyId);
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
