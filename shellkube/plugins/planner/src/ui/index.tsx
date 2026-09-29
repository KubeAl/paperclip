import { useEffect, useMemo, useState } from "react";
import type React from "react";
import {
  useHostNavigation, usePluginAction, usePluginData,
  type PluginDetailTabProps, type PluginPageProps, type PluginSidebarProps, type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { expandCron } from "./cron";

const TZ = "Asia/Kolkata";
type Task = { issue_id: string; identifier: string | null; title: string; status: string; priority: string;
  assignee: string | null; due_on?: string | null; start_on?: string | null };
type CalendarData = { today: string; from: string; to: string; dated: Task[]; overdue: Task[]; undated: Task[] };
type Bookmark = { id: string; title: string; url: string; tag: string; note: string };
type RoutineItem = { id: string; title: string; status: string;
  triggers: { kind: string; enabled: boolean; cronExpression: string | null; timezone: string | null; label?: string | null }[] };

// ---------- helpers ----------
const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const dayInTz = (ms: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(ms));
const timeInTz = (ms: number) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(new Date(ms));
const STATUS_COLOR: Record<string, string> = { backlog: "#94a3b8", todo: "#3b82f6", in_progress: "#f59e0b",
  in_review: "#a855f7", blocked: "#ef4444", done: "#22c55e", cancelled: "#64748b" };

const card: React.CSSProperties = { border: "1px solid var(--border, rgba(127,127,127,.25))", borderRadius: 8, padding: 12 };
const btn: React.CSSProperties = { border: "1px solid var(--border, rgba(127,127,127,.35))", borderRadius: 6, padding: "4px 10px",
  background: "transparent", color: "inherit", font: "inherit", cursor: "pointer" };
const input: React.CSSProperties = { border: "1px solid var(--border, rgba(127,127,127,.35))", borderRadius: 6, padding: "4px 8px",
  background: "transparent", color: "inherit", font: "inherit" };
const muted: React.CSSProperties = { opacity: 0.65, fontSize: 12 };

function Dot({ status }: { status: string }) {
  return <span title={status} style={{ display: "inline-block", width: 8, height: 8, borderRadius: 4, flexShrink: 0,
    background: STATUS_COLOR[status] ?? "#94a3b8" }} />;
}

function TaskLink({ t, extra }: { t: Task; extra?: React.ReactNode }) {
  const nav = useHostNavigation();
  const ref = t.identifier ?? t.issue_id;
  return (
    <a {...nav.linkProps(`/issues/${ref}`)} title={`${ref} · ${t.title} · ${t.status}${t.assignee ? " · " + t.assignee : ""}`}
      style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, color: "inherit", textDecoration: "none",
        overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" }}>
      <Dot status={t.status} />
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{t.identifier ? <b>{t.identifier}</b> : null} {t.title}</span>
      {extra}
    </a>
  );
}

function SidebarLink({ route, label, icon }: { route: string; label: string; icon: React.ReactNode }) {
  const nav = useHostNavigation();
  const href = nav.resolveHref(`/${route}`);
  const active = typeof window !== "undefined" && window.location.pathname === href;
  return (
    <a {...nav.linkProps(`/${route}`)} aria-current={active ? "page" : undefined}
      className={["flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50 hover:text-foreground"].join(" ")}>
      <span className="relative shrink-0">{icon}</span><span className="flex-1 truncate">{label}</span>
    </a>
  );
}
const svg = (children: React.ReactNode) => (
  <svg viewBox="0 0 24 24" className="h-4 w-4" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.9"
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{children}</svg>);

export function CalendarSidebarLink(_: PluginSidebarProps) {
  return <SidebarLink route="calendar" label="Calendar" icon={svg(<><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>)} />;
}
export function BookmarksSidebarLink(_: PluginSidebarProps) {
  return <SidebarLink route="bookmarks" label="Bookmarks" icon={svg(<path d="M6 3h12v18l-6-4-6 4z" />)} />;
}

// ---------- routines (read through the normal API with the board session) ----------
function useRoutines(companyId: string | null) {
  const [items, setItems] = useState<RoutineItem[]>([]);
  useEffect(() => {
    if (!companyId) return;
    let live = true;
    fetch(`/api/companies/${companyId}/routines`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : [])).then((d) => { if (live) setItems(Array.isArray(d) ? d : []); }).catch(() => {});
    return () => { live = false; };
  }, [companyId]);
  return items;
}

type RoutineHit = { title: string; first: number; count: number };
function routineHits(routines: RoutineItem[], from: string, to: string): Map<string, RoutineHit[]> {
  const byDay = new Map<string, Map<string, RoutineHit>>();
  for (const r of routines) {
    if (r.status && r.status !== "active") continue;
    for (const t of r.triggers ?? []) {
      if (t.kind !== "schedule" || !t.enabled || !t.cronExpression) continue;
      for (const ms of expandCron(t.cronExpression, t.timezone || "UTC", from, to)) {
        const day = dayInTz(ms);
        if (day < from || day > to) continue;
        const m = byDay.get(day) ?? new Map<string, RoutineHit>();
        const key = r.id + (t.label ?? "");
        const hit = m.get(key);
        if (hit) { hit.count += 1; hit.first = Math.min(hit.first, ms); } else m.set(key, { title: r.title, first: ms, count: 1 });
        byDay.set(day, m);
      }
    }
  }
  return new Map([...byDay].map(([d, m]) => [d, [...m.values()].sort((a, b) => a.first - b.first)]));
}

// ---------- calendar page ----------
export function CalendarPage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const now = new Date();
  const [ym, setYm] = useState<{ y: number; m: number }>({ y: now.getFullYear(), m: now.getMonth() + 1 });
  const first = new Date(Date.UTC(ym.y, ym.m - 1, 1));
  const lead = (first.getUTCDay() + 6) % 7; // weeks start Monday
  const start = new Date(first.getTime() - lead * 86400000);
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 86400000));
  const from = days[0].toISOString().slice(0, 10), to = days[41].toISOString().slice(0, 10);
  const { data, loading, error } = usePluginData<CalendarData>("calendar", { companyId, from, to });
  const routines = useRoutines(companyId);
  const hits = useMemo(() => routineHits(routines, from, to), [routines, from, to]);
  const tasksByDay = useMemo(() => {
    const m = new Map<string, { t: Task; kind: "due" | "start" }[]>();
    for (const t of data?.dated ?? []) {
      if (t.due_on) m.set(t.due_on, [...(m.get(t.due_on) ?? []), { t, kind: "due" }]);
      if (t.start_on && t.start_on !== t.due_on) m.set(t.start_on, [...(m.get(t.start_on) ?? []), { t, kind: "start" }]);
    }
    return m;
  }, [data]);
  const shift = (n: number) => setYm(({ y, m }) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1 }; });
  const todayIso = data?.today ?? dayInTz(Date.now());
  const monthLabel = first.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

  return (
    <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) 280px", gap: 16, padding: 16 }}>
      <section>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0, flex: 1 }}>{monthLabel}</h1>
          <button style={btn} onClick={() => shift(-1)}>‹</button>
          <button style={btn} onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() + 1 })}>Today</button>
          <button style={btn} onClick={() => shift(1)}>›</button>
        </div>
        {error ? <div style={{ color: "#ef4444" }}>Calendar error: {error.message}</div> : null}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 4 }}>
          {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} style={{ ...muted, padding: "0 4px" }}>{d}</div>)}
          {days.map((d) => {
            const key = d.toISOString().slice(0, 10);
            const inMonth = d.getUTCMonth() + 1 === ym.m;
            const items = tasksByDay.get(key) ?? [];
            const rs = hits.get(key) ?? [];
            return (
              <div key={key} style={{ ...card, padding: 6, minHeight: 104, opacity: inMonth ? 1 : 0.45,
                outline: key === todayIso ? "2px solid #3b82f6" : undefined, display: "flex", flexDirection: "column", gap: 3 }}>
                <div style={{ fontSize: 12, fontWeight: key === todayIso ? 700 : 500 }}>{d.getUTCDate()}</div>
                {items.map(({ t, kind }) => (
                  <TaskLink key={t.issue_id + kind} t={t} extra={<span style={{ ...muted, fontSize: 10 }}>{kind === "start" ? "▶ start" : key < todayIso && !["done", "cancelled"].includes(t.status) ? "⚠ due" : "due"}</span>} />
                ))}
                {rs.slice(0, 3).map((r) => (
                  <div key={r.title + r.first} title={`Routine: ${r.title}`} style={{ fontSize: 11, opacity: 0.8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    ↻ {timeInTz(r.first)} {r.title}{r.count > 1 ? ` ×${r.count}` : ""}
                  </div>
                ))}
                {rs.length > 3 ? <div style={muted}>+{rs.length - 3} routines</div> : null}
              </div>
            );
          })}
        </div>
        <div style={{ ...muted, marginTop: 8 }}>
          Times in IST. ↻ = routine run (from its schedule). ▶ start = task moves from backlog to todo that day (agent wakes). Set dates in a task's Schedule panel.
          {loading ? " Loading…" : ""}
        </div>
      </section>
      <aside style={{ display: "grid", gap: 12, alignContent: "start" }}>
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6, color: (data?.overdue.length ?? 0) > 0 ? "#ef4444" : undefined }}>Overdue ({data?.overdue.length ?? 0})</div>
          <div style={{ display: "grid", gap: 4 }}>
            {(data?.overdue ?? []).map((t) => <TaskLink key={t.issue_id} t={t} extra={<span style={muted}>{t.due_on}</span>} />)}
            {data && data.overdue.length === 0 ? <div style={muted}>Nothing overdue.</div> : null}
          </div>
        </div>
        <div style={card}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Pending, no date ({data?.undated.length ?? 0})</div>
          <div style={{ display: "grid", gap: 4, maxHeight: 480, overflowY: "auto" }}>
            {(data?.undated ?? []).map((t) => <TaskLink key={t.issue_id} t={t} extra={<span style={muted}>{t.status}</span>} />)}
            {data && data.undated.length === 0 ? <div style={muted}>All pending tasks have dates.</div> : null}
          </div>
        </div>
      </aside>
    </div>
  );
}

// ---------- task Schedule panel ----------
export function TaskSchedule({ context }: PluginDetailTabProps) {
  const { data, refresh } = usePluginData<{ due_on: string | null; start_on: string | null; auto_started_at: string | null }>(
    "task-dates", { issueId: context.entityId });
  const save = usePluginAction("set-task-dates");
  const [due, setDue] = useState(""), [start, setStart] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => { setDue(data?.due_on ?? ""); setStart(data?.start_on ?? ""); }, [data?.due_on, data?.start_on]);
  const submit = async (dueOn: string, startOn: string) => {
    setMsg(null);
    try { await save({ companyId: context.companyId, issueId: context.entityId, dueOn, startOn }); setMsg("Saved"); refresh(); }
    catch (e) { setMsg(`Error: ${(e as Error).message}`); }
  };
  return (
    <div style={{ ...card, display: "flex", flexWrap: "wrap", gap: 12, alignItems: "end", fontSize: 13 }}>
      <label style={{ display: "grid", gap: 4 }}><span style={muted}>Due date</span>
        <input type="date" style={input} value={due} onChange={(e) => setDue(e.target.value)} /></label>
      <label style={{ display: "grid", gap: 4 }}><span style={muted}>Start on (backlog → todo)</span>
        <input type="date" style={input} value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <button style={btn} onClick={() => submit(due, start)}>Save</button>
      {(data?.due_on || data?.start_on) ? <button style={btn} onClick={() => submit("", "")}>Clear</button> : null}
      <span style={muted}>{msg ?? (data?.auto_started_at ? `Auto-started ${new Date(data.auto_started_at).toLocaleString("en-GB", { timeZone: TZ })}` : "Schedule (Planner)")}</span>
    </div>
  );
}

// ---------- dashboard widget ----------
export function DueWidget({ context }: PluginWidgetProps) {
  const { data } = usePluginData<{ overdue: number; week: number }>("due-summary", { companyId: context.companyId });
  const nav = useHostNavigation();
  return (
    <a {...nav.linkProps("/calendar")} style={{ display: "grid", gap: 4, color: "inherit", textDecoration: "none" }}>
      <strong>Planner</strong>
      <span><b style={{ color: (data?.overdue ?? 0) > 0 ? "#ef4444" : undefined }}>{data?.overdue ?? "–"}</b> overdue · <b>{data?.week ?? "–"}</b> due in 7 days</span>
      <span style={muted}>Open calendar →</span>
    </a>
  );
}

// ---------- bookmarks page ----------
export function BookmarksPage({ context }: PluginPageProps) {
  const companyId = context.companyId;
  const { data, refresh, error } = usePluginData<Bookmark[]>("bookmarks", { companyId });
  const add = usePluginAction("add-bookmark"), del = usePluginAction("delete-bookmark");
  const [form, setForm] = useState({ title: "", url: "", tag: "", note: "" });
  const [filter, setFilter] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const groups = useMemo(() => {
    const q = filter.toLowerCase();
    const m = new Map<string, Bookmark[]>();
    for (const b of data ?? []) {
      if (q && !`${b.title} ${b.url} ${b.tag} ${b.note}`.toLowerCase().includes(q)) continue;
      m.set(b.tag || "Untagged", [...(m.get(b.tag || "Untagged") ?? []), b]);
    }
    return [...m];
  }, [data, filter]);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setMsg(null);
    try { await add({ companyId, ...form }); setForm({ title: "", url: "", tag: form.tag, note: "" }); refresh(); }
    catch (err) { setMsg(`Error: ${(err as Error).message}`); }
  };
  const isInternal = (u: string) => u.startsWith("/");
  return (
    <div style={{ padding: 16, display: "grid", gap: 16, maxWidth: 1000 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600, margin: 0 }}>Bookmarks</h1>
      <form onSubmit={submit} style={{ ...card, display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input style={{ ...input, flex: "2 1 240px" }} placeholder="URL (https://… or /SHEA/issues/SHEA-2)" value={form.url} required
          onChange={(e) => setForm({ ...form, url: e.target.value })} />
        <input style={{ ...input, flex: "2 1 180px" }} placeholder="Title" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        <input style={{ ...input, flex: "1 1 100px" }} placeholder="Tag" value={form.tag} onChange={(e) => setForm({ ...form, tag: e.target.value })} />
        <input style={{ ...input, flex: "3 1 240px" }} placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        <button style={btn} type="submit">Add</button>
        {msg ? <span style={{ color: "#ef4444", fontSize: 12 }}>{msg}</span> : null}
      </form>
      <input style={{ ...input, maxWidth: 320 }} placeholder="Filter…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      {error ? <div style={{ color: "#ef4444" }}>{error.message}</div> : null}
      {groups.length === 0 ? <div style={muted}>No bookmarks yet.</div> : null}
      {groups.map(([tag, items]) => (
        <section key={tag} style={card}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>{tag} <span style={muted}>({items.length})</span></div>
          <div style={{ display: "grid", gap: 6 }}>
            {items.map((b) => (
              <div key={b.id} style={{ display: "flex", gap: 8, alignItems: "baseline" }}>
                <a href={b.url} target={isInternal(b.url) ? undefined : "_blank"} rel="noreferrer" style={{ color: "#3b82f6", fontWeight: 500 }}>{b.title}</a>
                <span style={{ ...muted, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.note || b.url}</span>
                <button style={{ ...btn, padding: "0 6px", fontSize: 11 }} title="Delete"
                  onClick={async () => { if (confirm(`Delete "${b.title}"?`)) { await del({ companyId, id: b.id }); refresh(); } }}>✕</button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
