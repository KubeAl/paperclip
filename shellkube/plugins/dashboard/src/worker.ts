import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";

// Widgets: tiles {items:[{key,label,value,format?,prev?,sources?,note?,good?}]}, table {key,columns:[{key,label,format?}],rows:[{key,...}]},
// bars {key,items:[{key,label,value,format?}]}, series {key,format?,points:[{x,y}]}, calendar {key,items:[{key,title,date?,image?,status?,issueId?,channels?}]}, text {text}.
type Item = Record<string, unknown> & { key?: string; label?: string; title?: string; value?: unknown; date?: string | null; issueId?: string };
type Widget = Record<string, unknown> & { kind: string; key?: string; title?: string; items?: Item[]; rows?: Item[]; columns?: Item[] };
type Section = { id: string; title?: string; note?: string; widgets: Widget[] };
type Dashboard = { title: string; ownerAgentId: string; updatedAt: string; sections: Section[] };
type Target = { op: "min" | "max"; value: number; by: string; at: string };
type Discussion = { issueId: string; identifier: string; label: string; shown: string; expected: string; by: string; at: string };

const UUID_RE = /^[0-9a-f-]{36}$/i;
const KINDS = new Set(["tiles", "table", "bars", "series", "calendar", "text"]);
const MAX_JSON = 600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const str = (v: unknown) => (typeof v === "string" ? v : "");
function uuid(v: unknown, label: string): string {
  const s = str(v).trim(); if (!UUID_RE.test(s)) throw new Error(`${label} must be a uuid`); return s;
}
const key = (projectId: string, stateKey: string) => ({ scopeKind: "project" as const, scopeId: projectId, stateKey });

function checkSections(v: unknown): Section[] {
  if (!Array.isArray(v)) throw new Error("sections must be an array");
  return v.map((s, i) => {
    if (!s || typeof s !== "object") throw new Error(`sections[${i}] must be an object`);
    const sec = s as Section;
    if (!str(sec.id)) throw new Error(`sections[${i}].id is required`);
    if (!Array.isArray(sec.widgets)) throw new Error(`sections[${i}].widgets must be an array`);
    sec.widgets.forEach((w, j) => {
      if (!KINDS.has(w?.kind)) throw new Error(`sections[${i}].widgets[${j}].kind must be one of ${[...KINDS].join(", ")}`);
    });
    return sec;
  });
}

// Every value a user can discuss or set a target on, by key.
function values(d: Dashboard | null) {
  const out = new Map<string, { label: string; value: unknown }>();
  for (const s of d?.sections ?? []) for (const w of s.widgets) {
    if (w.kind === "tiles") for (const it of w.items ?? []) out.set(str(it.key), { label: str(it.label), value: it.value });
    if (w.kind === "bars") for (const it of w.items ?? []) out.set(`${w.key}.${it.key}`, { label: `${w.title ?? w.key}: ${it.label}`, value: it.value });
    if (w.kind === "table") for (const r of w.rows ?? []) for (const c of w.columns ?? [])
      out.set(`${w.key}.${r.key}.${c.key}`, { label: `${w.title ?? w.key}: ${str(r[str((w.columns ?? [])[0]?.key)]) || r.key} · ${c.label}`, value: r[str(c.key)] });
  }
  return out;
}
const misses = (t: Target, v: unknown) => typeof v === "number" && (t.op === "min" ? v < t.value : v > t.value);

const queues = new Map<string, Promise<unknown>>();
function serial<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const run = (queues.get(projectId) ?? Promise.resolve()).then(fn, fn);
  queues.set(projectId, run.catch(() => undefined));
  return run;
}

const plugin = definePlugin({
  async setup(ctx: PluginContext) {
    const opened = new Set<string>();
    const get = async <T>(projectId: string, k: string, empty: T) => ((await ctx.state.get(key(projectId, k))) ?? empty) as T;
    const set = (projectId: string, k: string, v: unknown) => ctx.state.set(key(projectId, k), v);
    const notify = (projectId: string, companyId: string) => {
      const ch = `project:${projectId}`;
      if (!opened.has(ch)) { ctx.streams.open(ch, companyId); opened.add(ch); }
      ctx.streams.emit(ch, { at: Date.now() });
    };
    async function project(projectId: string, companyId: string) {
      const p = await ctx.projects.get(projectId, companyId);
      if (!p) throw new Error("Project not found in this company");
      return p;
    }
    async function snapshot(projectId: string, companyId: string) {
      const dashboard = await get<Dashboard | null>(projectId, "dashboard", null);
      const targets = await get<Record<string, Target>>(projectId, "targets", {});
      const discussions = await get<Record<string, Discussion[]>>(projectId, "discussions", {});
      const vals = values(dashboard);
      const latest: Record<string, Discussion & { status: string }> = {};
      await Promise.all(Object.entries(discussions).map(async ([k, list]) => {
        const d = list.at(-1)!;
        const issue = await ctx.issues.get(d.issueId, companyId);
        latest[k] = { ...d, status: issue?.status ?? "deleted" };
      }));
      const offTarget = Object.entries(targets).filter(([k, t]) => misses(t, vals.get(k)?.value))
        .map(([k, t]) => ({ key: k, label: vals.get(k)?.label, value: vals.get(k)?.value, target: t }));
      return { dashboard, targets, discussions: latest, offTarget };
    }

    ctx.tools.register("dashboard_get", { displayName: "Dashboard: read", description: "", parametersSchema: {} }, async (params, run) => {
      const projectId = uuid((params as Record<string, unknown>).projectId, "projectId");
      await project(projectId, run.companyId);
      const snap = await snapshot(projectId, run.companyId);
      return { content: snap.dashboard ? JSON.stringify(snap) : "No dashboard on this project yet. Create one with dashboard_update.", data: snap };
    });

    ctx.tools.register("dashboard_update", { displayName: "Dashboard: update", description: "", parametersSchema: {} }, async (params, run) => {
      const p = params as Record<string, unknown>;
      const projectId = uuid(p.projectId, "projectId");
      const proj = await project(projectId, run.companyId);
      const incoming = p.sections === undefined ? [] : checkSections(p.sections);
      const remove = new Set(Array.isArray(p.removeSections) ? p.removeSections.map(String) : []);
      const d = await serial(projectId, async () => {
        const cur = await get<Dashboard | null>(projectId, "dashboard", null);
        const sections = (cur?.sections ?? []).filter((s) => !remove.has(s.id));
        for (const s of incoming) {
          const i = sections.findIndex((x) => x.id === s.id);
          if (i >= 0) sections[i] = s; else sections.push(s);
        }
        const next: Dashboard = { title: str(p.title) || cur?.title || proj.name, ownerAgentId: run.agentId, updatedAt: new Date().toISOString(), sections };
        if (JSON.stringify(next).length > MAX_JSON) throw new Error(`Dashboard is larger than ${MAX_JSON} bytes`);
        await set(projectId, "dashboard", next);
        return next;
      });
      notify(projectId, run.companyId);
      return { content: `Dashboard saved: ${d.sections.length} sections (${d.sections.map((s) => s.id).join(", ")}).` };
    });

    ctx.data.register("dashboard", async (params) => {
      const companyId = uuid(params.companyId, "companyId"), projectId = uuid(params.projectId, "projectId");
      await project(projectId, companyId);
      return snapshot(projectId, companyId);
    });

    function user(actor: { type: string; userId?: string | null }) {
      if (actor.type !== "user" || !actor.userId) throw new Error("Only signed-in users can do this");
      return actor.userId;
    }
    async function owner(projectId: string) {
      const d = await get<Dashboard | null>(projectId, "dashboard", null);
      if (!d) throw new Error("This project has no dashboard yet");
      return d;
    }

    // A value looks wrong: open a task for the dashboard's agent, created by the user, so it runs and the talk stays on that task.
    ctx.actions.register("discuss", async (params, { actor }) => {
      const userId = user(actor);
      const companyId = uuid(params.companyId, "companyId"), projectId = uuid(params.projectId, "projectId");
      await project(projectId, companyId);
      const d = await owner(projectId);
      const k = str(params.key), v = values(d).get(k);
      if (!v) throw new Error("This value is no longer on the dashboard");
      const shown = str(params.shown).slice(0, 200), expected = str(params.expected).slice(0, 200), note = str(params.note).slice(0, 4000);
      const issue = await ctx.issues.create({
        companyId, projectId, assigneeAgentId: d.ownerAgentId, status: "todo", priority: "medium",
        title: `Dashboard: ${v.label} shows ${shown}${expected ? `, I see ${expected}` : ""}`.slice(0, 200),
        description: [`Value \`${k}\` on the project dashboard.`, "", `- Dashboard shows: **${shown}**`,
          expected ? `- I see / expect: **${expected}**` : "", note ? `\n${note}` : "", "",
          "Find out which number is right and why they differ. Reply here. If the dashboard is wrong, fix it with dashboard_update."]
          .filter((l) => l !== null).join("\n"),
        actor: { actorUserId: userId },
      });
      await serial(projectId, async () => {
        const all = await get<Record<string, Discussion[]>>(projectId, "discussions", {});
        all[k] = [...(all[k] ?? []), { issueId: issue.id, identifier: issue.identifier ?? "", label: v.label, shown, expected, by: userId, at: new Date().toISOString() }].slice(-10);
        await set(projectId, "discussions", all);
      });
      notify(projectId, companyId);
      return { ok: true, issueId: issue.id, identifier: issue.identifier };
    });

    ctx.actions.register("target", async (params, { actor }) => {
      const userId = user(actor);
      const companyId = uuid(params.companyId, "companyId"), projectId = uuid(params.projectId, "projectId");
      await project(projectId, companyId);
      const k = str(params.key);
      if (!values(await owner(projectId)).has(k)) throw new Error("This value is no longer on the dashboard");
      await serial(projectId, async () => {
        const all = await get<Record<string, Target>>(projectId, "targets", {});
        const value = Number(params.value);
        if (params.value === null || params.value === "" || !Number.isFinite(value)) delete all[k];
        else all[k] = { op: params.op === "max" ? "max" : "min", value, by: userId, at: new Date().toISOString() };
        await set(projectId, "targets", all);
      });
      notify(projectId, companyId);
      return { ok: true };
    });

    // A plan item dragged to a day (or back to unscheduled). The agent hears about it on the item's task.
    ctx.actions.register("schedule", async (params, { actor }) => {
      const userId = user(actor);
      const companyId = uuid(params.companyId, "companyId"), projectId = uuid(params.projectId, "projectId");
      await project(projectId, companyId);
      const date = params.date ? str(params.date) : null;
      if (date && !DATE_RE.test(date)) throw new Error("date must be YYYY-MM-DD");
      const k = str(params.key);
      const { item, d } = await serial(projectId, async () => {
        const d = await owner(projectId);
        const item = d.sections.flatMap((s) => s.widgets).filter((w) => w.kind === "calendar").flatMap((w) => w.items ?? []).find((i) => i.key === k);
        if (!item) throw new Error("This item is no longer on the plan");
        item.date = date; item.movedBy = userId; item.movedAt = new Date().toISOString();
        await set(projectId, "dashboard", d);
        return { item, d };
      });
      const what = `**${str(item.title) || k}**`;
      const msg = date ? `I moved ${what} to **${date}** on the dashboard plan. Prepare it for that day.` : `I took ${what} off the plan (no date).`;
      if (item.issueId && UUID_RE.test(item.issueId) && (await ctx.issues.get(item.issueId, companyId))) {
        await ctx.issues.createComment(item.issueId, msg, companyId, { actorUserId: userId });
      } else if (date) {
        const issue = await ctx.issues.create({
          companyId, projectId, assigneeAgentId: d.ownerAgentId, status: "todo", priority: "medium",
          title: `Plan: ${str(item.title) || k} on ${date}`.slice(0, 200), description: `${msg}\n\nPlan item \`${k}\`.`, actor: { actorUserId: userId },
        });
        await serial(projectId, async () => {
          const cur = await owner(projectId);
          const it = cur.sections.flatMap((s) => s.widgets).filter((w) => w.kind === "calendar").flatMap((w) => w.items ?? []).find((i) => i.key === k);
          if (it) { it.issueId = issue.id; await set(projectId, "dashboard", cur); }
        });
      }
      notify(projectId, companyId);
      return { ok: true };
    });
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
