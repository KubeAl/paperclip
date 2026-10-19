import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";

type Op = { target?: string; mode?: "inner" | "outer" | "append" | "prepend" | "text" | "remove"; html?: string };
type Input = { seq: number; action: string; values: unknown; userId: string; at: string; wake: boolean };
type Panel = {
  name: string; title: string; html: string; patches: Op[]; data: Record<string, unknown>;
  version: number; rev: number; seq: number; inputs: Input[]; agentId: string; updatedAt: string;
  renderSeq?: number; // input seq at the last render: later inputs are restored into that render's forms
};
type Panels = Record<string, Panel>;

const UUID_RE = /^[0-9a-f-]{36}$/i;
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/i;
const MODES = new Set(["inner", "outer", "append", "prepend", "text", "remove"]);
const MAX_HTML = 256_000, MAX_JSON = 64_000, MAX_PATCHES = 300, MAX_PANELS = 8, MAX_INPUTS = 50, MAX_WAIT_S = 25;

function str(v: unknown): string { return typeof v === "string" ? v : ""; }
function uuid(v: unknown, label: string): string {
  const s = str(v).trim(); if (!UUID_RE.test(s)) throw new Error(`${label} must be a uuid`); return s;
}
function panelName(v: unknown): string {
  const s = str(v).trim() || "main"; if (!NAME_RE.test(s)) throw new Error("panel: letters, digits, - and _ (max 40)"); return s;
}
function obj(v: unknown, label: string): Record<string, unknown> | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${label} must be an object`);
  if (JSON.stringify(v).length > MAX_JSON) throw new Error(`${label} is larger than ${MAX_JSON} bytes`);
  return v as Record<string, unknown>;
}
const key = (issueId: string) => ({ scopeKind: "issue" as const, scopeId: issueId, stateKey: "panels" });
const channel = (issueId: string) => `issue:${issueId}`;

// One writer per issue at a time (read-modify-write of the panels record).
const queues = new Map<string, Promise<unknown>>();
function serial<T>(issueId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(issueId) ?? Promise.resolve()).then(fn, fn);
  queues.set(issueId, run.catch(() => undefined));
  return run;
}
// live_input callers waiting for the next submit, per issue+panel.
const waiters = new Map<string, Set<() => void>>();

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const opened = new Set<string>();
    const load = async (issueId: string) => ((await ctx.state.get(key(issueId))) ?? {}) as Panels;
    const save = (issueId: string, panels: Panels) => ctx.state.set(key(issueId), panels);
    const notify = (issueId: string, companyId: string, panel: string) => {
      const ch = channel(issueId);
      if (!opened.has(ch)) { ctx.streams.open(ch, companyId); opened.add(ch); }
      ctx.streams.emit(ch, { panel });
    };
    async function issueIn(issueId: string, companyId: string) {
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error("Task not found in this company");
      return issue;
    }
    async function update(issueId: string, companyId: string, name: string, fn: (p: Panel | undefined, all: Panels) => Panel | null) {
      await issueIn(issueId, companyId);
      const result = await serial(issueId, async () => {
        const all = await load(issueId);
        const next = fn(all[name], all);
        if (next) { next.rev = (all[name]?.rev ?? 0) + 1; next.updatedAt = new Date().toISOString(); all[name] = next; }
        else delete all[name];
        await save(issueId, all);
        return next;
      });
      notify(issueId, companyId, name);
      return result;
    }

    ctx.tools.register("live_render", {
      displayName: "Live panel: render", description: "Show or replace an HTML panel.", parametersSchema: {},
    }, async (params, run) => {
      const p = params as Record<string, unknown>;
      const issueId = uuid(p.issueId, "issueId"), name = panelName(p.panel), html = str(p.html);
      if (html.length > MAX_HTML) return { error: `html is larger than ${MAX_HTML} bytes; send less or use live_patch` };
      const data = obj(p.data, "data");
      const next = await update(issueId, run.companyId, name, (cur, all) => {
        if (!html.trim()) return null;
        if (!cur && Object.keys(all).length >= MAX_PANELS) throw new Error(`at most ${MAX_PANELS} panels per task`);
        return {
          name, title: str(p.title) || cur?.title || "", html, patches: [], data: data ?? cur?.data ?? {},
          version: (cur?.version ?? 0) + 1, rev: 0, seq: cur?.seq ?? 0, renderSeq: cur?.seq ?? 0, inputs: cur?.inputs ?? [],
          agentId: run.agentId, updatedAt: "",
        };
      });
      return { content: next ? `Panel "${name}" shown (version ${next.version}).` : `Panel "${name}" removed.` };
    });

    ctx.tools.register("live_patch", {
      displayName: "Live panel: patch", description: "Patch part of a panel.", parametersSchema: {},
    }, async (params, run) => {
      const p = params as Record<string, unknown>;
      const issueId = uuid(p.issueId, "issueId"), name = panelName(p.panel), data = obj(p.data, "data");
      const ops: Op[] = (Array.isArray(p.ops) ? p.ops : []).map((o: any) => {
        const mode = o?.mode ?? "inner";
        if (!MODES.has(mode)) throw new Error(`unknown mode ${mode}`);
        return { target: str(o?.target) || undefined, mode, html: str(o?.html) };
      });
      if (!ops.length && !data) return { error: "nothing to patch: give ops and/or data" };
      if (JSON.stringify(ops).length > MAX_HTML) return { error: `ops are larger than ${MAX_HTML} bytes` };
      const next = await update(issueId, run.companyId, name, (cur) => {
        if (!cur) throw new Error(`no panel "${name}"; call live_render first`);
        if (cur.patches.length + ops.length > MAX_PATCHES) throw new Error(`more than ${MAX_PATCHES} patches since the last render; call live_render with the whole page`);
        return { ...cur, patches: [...cur.patches, ...ops], data: data ? { ...cur.data, ...data } : cur.data };
      });
      return { content: `Panel "${name}" patched (${next!.patches.length} patches since render).` };
    });

    ctx.tools.register("live_input", {
      displayName: "Live panel: read input", description: "Read submitted input.", parametersSchema: {},
    }, async (params, run) => {
      const p = params as Record<string, unknown>;
      const issueId = uuid(p.issueId, "issueId"), name = panelName(p.panel);
      const after = Number(p.after ?? 0) || 0, wait = Math.min(Math.max(Number(p.waitSeconds ?? 0) || 0, 0), MAX_WAIT_S);
      await issueIn(issueId, run.companyId);
      const read = async () => (await load(issueId))[name]?.inputs.filter((i) => i.seq > after) ?? [];
      let inputs = await read();
      if (!inputs.length && wait > 0) {
        const k = `${issueId}:${name}`;
        await new Promise<void>((resolve) => {
          const set = waiters.get(k) ?? new Set(); waiters.set(k, set);
          const done = () => { clearTimeout(timer); set.delete(done); resolve(); };
          const timer = setTimeout(done, wait * 1000);
          set.add(done);
        });
        inputs = await read();
      }
      return { content: inputs.length ? JSON.stringify(inputs) : "No new input.", data: inputs };
    });

    ctx.data.register("panels", async (params) => {
      const companyId = uuid(params.companyId, "companyId"), issueId = uuid(params.issueId, "issueId");
      await issueIn(issueId, companyId);
      const all = await load(issueId);
      return Object.values(all).sort((a, b) => a.name.localeCompare(b.name))
        .map(({ inputs, renderSeq = 0, ...rest }) => {
          const saved: Record<string, unknown> = {};
          for (const i of inputs) if (i.seq > renderSeq) saved[i.action] = i.values;
          return { ...rest, lastInput: inputs.at(-1) ?? null, saved };
        });
    });

    ctx.actions.register("submit", async (params, { actor }) => {
      if (actor.type !== "user" || !actor.userId) throw new Error("Only signed-in users can submit a panel");
      const companyId = uuid(params.companyId, "companyId"), issueId = uuid(params.issueId, "issueId");
      const name = panelName(params.panel), action = str(params.action).trim().slice(0, 80) || "submit";
      const wake = params.wake !== false, values = params.values ?? {};
      if (JSON.stringify(values).length > MAX_JSON) throw new Error("Input is too large");
      let input: Input | undefined;
      await update(issueId, companyId, name, (cur) => {
        if (!cur) throw new Error("This panel no longer exists");
        input = { seq: cur.seq + 1, action, values, userId: actor.userId!, at: new Date().toISOString(), wake };
        return { ...cur, seq: input.seq, inputs: [...cur.inputs, input].slice(-MAX_INPUTS) };
      });
      waiters.get(`${issueId}:${name}`)?.forEach((done) => done());
      if (wake) {
        // A comment attributed to the user wakes the assignee like any user comment, and Hindsight keeps it.
        const body = `Live panel \`${name}\` · \`${action}\` · #${input!.seq}\n\n\`\`\`json\n${JSON.stringify(values, null, 2)}\n\`\`\``;
        await ctx.issues.createComment(issueId, body, companyId, { actorUserId: actor.userId });
      }
      return { ok: true, seq: input!.seq };
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
