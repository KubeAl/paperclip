import { randomUUID } from "node:crypto";
import { definePlugin, runWorker } from "@paperclipai/plugin-sdk";

const TZ = "Asia/Kolkata";
const NS = "plugin_planner_8a0184621c";
const PENDING = ["backlog", "todo", "blocked", "in_progress", "in_review"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f-]{36}$/i;

function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}
function str(v: unknown): string { return typeof v === "string" ? v.trim() : ""; }
function uuid(v: unknown, label: string): string {
  const s = str(v); if (!UUID_RE.test(s)) throw new Error(`${label} must be a uuid`); return s;
}
function dateOrNull(v: unknown, label: string): string | null {
  const s = str(v); if (!s) return null; if (!DATE_RE.test(s)) throw new Error(`${label} must be YYYY-MM-DD`); return s;
}

const ISSUE_COLS = `i.id AS issue_id, i.identifier, i.title, i.status, i.priority, a.name AS assignee`;

const plugin = definePlugin({
  async setup(ctx) {
    ctx.data.register("task-dates", async (params) => {
      const issueId = uuid(params.issueId, "issueId");
      const rows = await ctx.db.query(
        `SELECT due_on::text AS due_on, start_on::text AS start_on, auto_started_at FROM ${NS}.task_dates WHERE issue_id = $1`, [issueId]);
      return rows[0] ?? { due_on: null, start_on: null, auto_started_at: null };
    });

    ctx.actions.register("set-task-dates", async (params) => {
      const companyId = uuid(params.companyId, "companyId");
      const issueId = uuid(params.issueId, "issueId");
      const due = dateOrNull(params.dueOn, "dueOn");
      const start = dateOrNull(params.startOn, "startOn");
      const issue = await ctx.issues.get(issueId, companyId);
      if (!issue) throw new Error("Task not found in this company");
      if (!due && !start) {
        await ctx.db.execute(`DELETE FROM ${NS}.task_dates WHERE issue_id = $1`, [issueId]);
        return { ok: true, cleared: true };
      }
      await ctx.db.execute(
        `INSERT INTO ${NS}.task_dates (issue_id, company_id, due_on, start_on, auto_started_at, updated_at)
         VALUES ($1, $2, $3::date, $4::date, NULL, now())
         ON CONFLICT (issue_id) DO UPDATE SET due_on = EXCLUDED.due_on, start_on = EXCLUDED.start_on,
           auto_started_at = CASE WHEN coalesce(${NS}.task_dates.start_on, DATE '1900-01-01') = coalesce(EXCLUDED.start_on, DATE '1900-01-01')
                                  THEN ${NS}.task_dates.auto_started_at ELSE NULL END,
           updated_at = now()`,
        [issueId, companyId, due, start]);
      return { ok: true };
    });

    ctx.data.register("calendar", async (params) => {
      const companyId = uuid(params.companyId, "companyId");
      const from = dateOrNull(params.from, "from") ?? today();
      const to = dateOrNull(params.to, "to") ?? from;
      const dated = await ctx.db.query(
        `SELECT ${ISSUE_COLS}, d.due_on::text AS due_on, d.start_on::text AS start_on
         FROM ${NS}.task_dates d JOIN public.issues i ON i.id = d.issue_id
         LEFT JOIN public.agents a ON a.id = i.assignee_agent_id
         WHERE d.company_id = $1 AND i.hidden_at IS NULL
           AND ((d.due_on BETWEEN $2::date AND $3::date) OR (d.start_on BETWEEN $2::date AND $3::date))
         ORDER BY d.due_on NULLS LAST`, [companyId, from, to]);
      const overdue = await ctx.db.query(
        `SELECT ${ISSUE_COLS}, d.due_on::text AS due_on
         FROM ${NS}.task_dates d JOIN public.issues i ON i.id = d.issue_id
         LEFT JOIN public.agents a ON a.id = i.assignee_agent_id
         WHERE d.company_id = $1 AND i.hidden_at IS NULL AND d.due_on < $2::date
           AND i.status NOT IN ('done', 'cancelled')
         ORDER BY d.due_on`, [companyId, today()]);
      const undated = await ctx.db.query(
        `SELECT ${ISSUE_COLS}
         FROM public.issues i LEFT JOIN public.agents a ON a.id = i.assignee_agent_id
         WHERE i.company_id = $1 AND i.hidden_at IS NULL AND i.status IN (${PENDING.map((s) => `'${s}'`).join(", ")})
           AND NOT EXISTS (SELECT 1 FROM ${NS}.task_dates d WHERE d.issue_id = i.id)
         ORDER BY i.created_at DESC LIMIT 200`, [companyId]);
      return { today: today(), from, to, dated, overdue, undated };
    });

    ctx.data.register("due-summary", async (params) => {
      const companyId = uuid(params.companyId, "companyId");
      const rows = await ctx.db.query<{ overdue: number; week: number }>(
        `SELECT count(*) FILTER (WHERE d.due_on < $2::date)::int AS overdue,
                count(*) FILTER (WHERE d.due_on BETWEEN $2::date AND $2::date + 7)::int AS week
         FROM ${NS}.task_dates d JOIN public.issues i ON i.id = d.issue_id
         WHERE d.company_id = $1 AND i.hidden_at IS NULL AND i.status NOT IN ('done', 'cancelled')`,
        [companyId, today()]);
      return { today: today(), ...(rows[0] ?? { overdue: 0, week: 0 }) };
    });

    ctx.data.register("bookmarks", async (params) => {
      const companyId = uuid(params.companyId, "companyId");
      return ctx.db.query(
        `SELECT id, title, url, tag, note, created_at FROM ${NS}.bookmarks WHERE company_id = $1 ORDER BY tag, title`, [companyId]);
    });

    ctx.actions.register("add-bookmark", async (params) => {
      const companyId = uuid(params.companyId, "companyId");
      const url = str(params.url);
      if (!url) throw new Error("url is required");
      const title = str(params.title) || url;
      await ctx.db.execute(
        `INSERT INTO ${NS}.bookmarks (id, company_id, title, url, tag, note) VALUES ($1, $2, $3, $4, $5, $6)`,
        [randomUUID(), companyId, title.slice(0, 300), url.slice(0, 2000), str(params.tag).slice(0, 60), str(params.note).slice(0, 2000)]);
      return { ok: true };
    });

    ctx.actions.register("delete-bookmark", async (params) => {
      const companyId = uuid(params.companyId, "companyId");
      const id = uuid(params.id, "id");
      await ctx.db.execute(`DELETE FROM ${NS}.bookmarks WHERE id = $1 AND company_id = $2`, [id, companyId]);
      return { ok: true };
    });

    ctx.jobs.register("auto-start", async () => {
      const due = await ctx.db.query<{ issue_id: string; company_id: string }>(
        `SELECT d.issue_id, d.company_id FROM ${NS}.task_dates d JOIN public.issues i ON i.id = d.issue_id
         WHERE d.start_on <= $1::date AND d.auto_started_at IS NULL AND i.status = 'backlog' AND i.hidden_at IS NULL`,
        [today()]);
      const enabled = new Map<string, boolean>();
      for (const row of due) {
        if (!enabled.has(row.company_id)) {
          const cfg = (await ctx.config.get(row.company_id).catch(() => null)) as { autoStart?: boolean } | null;
          enabled.set(row.company_id, cfg?.autoStart !== false);
        }
        if (!enabled.get(row.company_id)) continue;
        try {
          await ctx.issues.update(row.issue_id, { status: "todo" }, row.company_id);
          await ctx.db.execute(`UPDATE ${NS}.task_dates SET auto_started_at = now() WHERE issue_id = $1`, [row.issue_id]);
          ctx.logger.info("planner auto-started task", { issueId: row.issue_id });
        } catch (err) {
          ctx.logger.warn(`planner auto-start failed for ${row.issue_id}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
    });
  },

  async onHealth() { return { status: "ok", message: "planner ready" }; },
});

export default plugin;
runWorker(plugin, import.meta.url);
