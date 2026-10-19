import { useCallback, useEffect, useMemo, useState, type DragEvent, type ReactNode } from "react";
import { usePluginAction, usePluginData, usePluginStream, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";

type Any = Record<string, any>;
type Target = { op: "min" | "max"; value: number };
type Discussion = { issueId: string; identifier: string; status: string; shown: string; expected: string; at: string };
type Snap = { dashboard: Any | null; targets: Record<string, Target>; discussions: Record<string, Discussion>; offTarget: Any[] };
type Pick = { key: string; label: string; value: unknown; format?: string; sources?: Record<string, unknown>; note?: string };

const CSS = `
.skd{display:grid;gap:22px;font-size:14px}
.skd h3{font-size:15px;font-weight:600;margin:0}
.skd .muted{color:var(--muted-foreground)}
.skd .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.skd .card{border:1px solid var(--border);border-radius:10px;background:var(--card);padding:14px}
.skd .tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px}
.skd .tile{border:1px solid var(--border);border-radius:10px;background:var(--card);padding:12px 14px;cursor:pointer;text-align:left;position:relative}
.skd .tile:hover,.skd .val:hover{border-color:var(--foreground)}
.skd .tile .v{font-size:24px;font-weight:600;letter-spacing:-.02em;margin:2px 0}
.skd .tile .l{font-size:12px;color:var(--muted-foreground)}
.skd .tile .s{font-size:12px;color:var(--muted-foreground);margin-top:4px}
.skd .miss{box-shadow:inset 0 -3px 0 #ef4444}
.skd .up{color:#16a34a}.skd .down{color:#dc2626}
.skd .dot{display:inline-block;width:8px;height:8px;border-radius:4px;margin-left:6px;vertical-align:middle}
.skd .tag{font-size:11px;border-radius:999px;padding:1px 7px;border:1px solid var(--border);white-space:nowrap}
.skd .tag.amber{background:#f59e0b22;border-color:#f59e0b88}.skd .tag.blue{background:#3b82f622;border-color:#3b82f688}.skd .tag.green{background:#22c55e22;border-color:#22c55e88}.skd .tag.red{background:#ef444422;border-color:#ef444488}
.skd table{width:100%;border-collapse:collapse;font-size:13px}
.skd th{text-align:left;font-weight:500;color:var(--muted-foreground);border-bottom:1px solid var(--border);padding:6px 8px}
.skd td{border-bottom:1px solid var(--border);padding:6px 8px}
.skd td.num,.skd th.num{text-align:right;font-variant-numeric:tabular-nums}
.skd .val{cursor:pointer;border:1px solid transparent;border-radius:6px;padding:1px 4px}
.skd .bar{display:grid;grid-template-columns:minmax(120px,220px) 1fr 90px;gap:10px;align-items:center;padding:3px 0}
.skd .bar .track{height:10px;border-radius:5px;background:var(--muted)}
.skd .bar .fill{height:10px;border-radius:5px;background:#3b82f6}
.skd .cal{display:grid;grid-template-columns:220px 1fr;gap:12px;align-items:start}
.skd .grid7{display:grid;grid-template-columns:repeat(7,1fr);border-left:1px solid var(--border);border-top:1px solid var(--border)}
.skd .day{min-height:86px;border-right:1px solid var(--border);border-bottom:1px solid var(--border);padding:4px;font-size:12px}
.skd .day.out{opacity:.4}.skd .day.today .n{background:var(--primary);color:var(--primary-foreground);border-radius:9px;padding:0 5px}
.skd .day.over{background:var(--accent)}
.skd .chip{display:flex;gap:6px;align-items:center;border:1px solid var(--border);border-left:3px solid var(--primary);border-radius:6px;padding:3px 5px;margin-top:4px;background:var(--card);cursor:grab;font-size:12px}
.skd .chip img{width:28px;height:28px;object-fit:cover;border-radius:3px}
.skd .chip.big img{width:44px;height:44px}
.skd button.b{border:1px solid var(--border);border-radius:6px;padding:3px 10px;background:var(--card);cursor:pointer}
.skd button.b.p{background:var(--primary);color:var(--primary-foreground);border-color:var(--primary)}
.skd input,.skd textarea,.skd select{border:1px solid var(--border);border-radius:6px;padding:5px 8px;background:var(--background);color:inherit;font:inherit}
.skd-modal{position:fixed;inset:0;background:#0007;display:grid;place-items:center;z-index:60}
.skd-modal .card{width:min(520px,92vw);display:grid;gap:12px}
`;

function fmt(v: unknown, f?: string): string {
  if (v === null || v === undefined || v === "") return "–";
  if (typeof v !== "number") return String(v);
  if (f === "inr") return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: v < 100 ? 2 : 0 });
  if (f === "pct") return (v * 100).toLocaleString("en-IN", { maximumFractionDigits: 1 }) + "%";
  return v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}
const differs = (s?: Record<string, unknown>) => !!s && new Set(Object.values(s).map((x) => JSON.stringify(x))).size > 1;
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function Marks({ k, sources, snap, prefix }: { k: string; sources?: Record<string, unknown>; snap: Snap; prefix: string }) {
  const d = snap.discussions[k], t = snap.targets[k];
  const open = d && !["done", "cancelled", "deleted"].includes(d.status);
  return (
    <>
      {differs(sources) && <span className="tag amber" title={Object.entries(sources!).map(([a, b]) => `${a}: ${b}`).join("\n")}>sources differ</span>}
      {d && <a className={`tag ${open ? "blue" : "green"}`} href={`/${prefix}/issues/${d.identifier || d.issueId}`} onClick={(e) => e.stopPropagation()}>
        {open ? "discussing" : "answered"} {d.identifier}</a>}
      {t && <span className="tag">{t.op === "min" ? "≥" : "≤"} {fmt(t.value)}</span>}
    </>
  );
}

function Tiles({ w, snap, open, prefix }: { w: Any; snap: Snap; open: (p: Pick) => void; prefix: string }) {
  return (
    <div className="tiles">
      {(w.items ?? []).map((it: Any) => {
        const t = snap.targets[it.key];
        const miss = t && typeof it.value === "number" && (t.op === "min" ? it.value < t.value : it.value > t.value);
        const delta = typeof it.value === "number" && typeof it.prev === "number" && it.prev !== 0 ? (it.value - it.prev) / Math.abs(it.prev) : null;
        const good = delta === null ? "" : (delta >= 0) === (it.good !== "down") ? "up" : "down";
        return (
          <button key={it.key} className={`tile${miss ? " miss" : ""}`} onClick={() => open({ ...it, label: it.label } as Pick)}>
            <div className="l">{it.label}</div>
            <div className="v">{fmt(it.value, it.format)}</div>
            <div className="s">
              {delta !== null && <span className={good}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta * 100).toFixed(0)}% </span>}
              {it.prev !== undefined && <span>prev {fmt(it.prev, it.format)}</span>}
            </div>
            <div className="row" style={{ marginTop: 6 }}><Marks k={it.key} sources={it.sources} snap={snap} prefix={prefix} /></div>
          </button>
        );
      })}
    </div>
  );
}

function Table({ w, snap, open, prefix }: { w: Any; snap: Snap; open: (p: Pick) => void; prefix: string }) {
  const cols: Any[] = w.columns ?? [];
  return (
    <div className="card" style={{ padding: 0, overflowX: "auto" }}>
      <table>
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.format && c.format !== "text" ? "num" : ""}>{c.label}</th>)}</tr></thead>
        <tbody>{(w.rows ?? []).map((r: Any) => (
          <tr key={r.key}>{cols.map((c, i) => {
            const k = `${w.key}.${r.key}.${c.key}`, v = r[c.key];
            if (i === 0 || typeof v !== "number") return <td key={c.key}>{fmt(v, c.format)}</td>;
            return (
              <td key={c.key} className="num">
                <Marks k={k} snap={snap} prefix={prefix} />
                <span className="val" onClick={() => open({ key: k, label: `${w.title ?? w.key}: ${r[cols[0].key]} · ${c.label}`, value: v, format: c.format })}>{fmt(v, c.format)}</span>
              </td>
            );
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Bars({ w, snap, open, prefix }: { w: Any; snap: Snap; open: (p: Pick) => void; prefix: string }) {
  const items: Any[] = w.items ?? [];
  const max = Math.max(1, ...items.map((i) => Number(i.value) || 0));
  return (
    <div className="card">
      {items.map((it) => {
        const k = `${w.key}.${it.key}`;
        return (
          <div key={it.key} className="bar">
            <span>{it.label} <Marks k={k} sources={it.sources} snap={snap} prefix={prefix} /></span>
            <div className="track"><div className="fill" style={{ width: `${(100 * (Number(it.value) || 0)) / max}%` }} /></div>
            <span className="val" style={{ textAlign: "right" }} onClick={() => open({ ...it, key: k, label: `${w.title ?? w.key}: ${it.label}`, format: it.format ?? w.format } as Pick)}>
              {fmt(it.value, it.format ?? w.format)}</span>
          </div>
        );
      })}
    </div>
  );
}

function Series({ w }: { w: Any }) {
  const pts: Any[] = w.points ?? [];
  const max = Math.max(1, ...pts.map((p) => Number(p.y) || 0));
  const W = 100 / Math.max(1, pts.length);
  return (
    <div className="card">
      <svg viewBox="0 0 100 40" preserveAspectRatio="none" style={{ width: "100%", height: 140, display: "block" }}>
        {pts.map((p, i) => <rect key={i} x={i * W + W * 0.15} width={W * 0.7} y={40 - (38 * (Number(p.y) || 0)) / max} height={(38 * (Number(p.y) || 0)) / max}
          fill="#3b82f6" opacity={0.85}><title>{`${p.x}: ${fmt(p.y, w.format)}`}</title></rect>)}
      </svg>
      <div className="row muted" style={{ justifyContent: "space-between", fontSize: 11 }}>
        <span>{pts[0]?.x}</span><span>max {fmt(max, w.format)}</span><span>{pts.at(-1)?.x}</span></div>
    </div>
  );
}

function Calendar({ w, prefix, schedule }: { w: Any; prefix: string; schedule: (key: string, date: string | null) => void }) {
  const items: Any[] = w.items ?? [];
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const [over, setOver] = useState<string | null>(null);
  const start = new Date(month); start.setDate(1 - ((month.getDay() + 6) % 7));
  const days = Array.from({ length: 42 }, (_, i) => { const d = new Date(start); d.setDate(start.getDate() + i); return d; });
  const today = iso(new Date());
  const drop = (date: string | null) => (e: DragEvent) => { e.preventDefault(); setOver(null); const k = e.dataTransfer.getData("text/plain"); if (k) schedule(k, date); };
  const chip = (it: Any, big = false) => (
    <div key={it.key} className={`chip${big ? " big" : ""}`} draggable onDragStart={(e) => e.dataTransfer.setData("text/plain", it.key)}
      style={{ borderLeftColor: it.color ?? undefined }} title={[it.title, it.status, it.note].filter(Boolean).join(" · ")}>
      {it.image && <img src={it.image} alt="" />}
      <div style={{ minWidth: 0 }}>
        <div style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{it.title}</div>
        <div className="row" style={{ gap: 4 }}>
          {it.status && <span className={`tag ${it.status === "posted" ? "green" : it.status === "blocked" ? "red" : ""}`}>{it.status}</span>}
          {it.issueId && <a className="tag" href={`/${prefix}/issues/${it.issueId}`} onClick={(e) => e.stopPropagation()}>task</a>}
        </div>
      </div>
    </div>
  );
  const move = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));
  return (
    <div className="cal">
      <div className={`card${over === "none" ? " over" : ""}`} onDragOver={(e) => { e.preventDefault(); setOver("none"); }} onDrop={drop(null)}>
        <h3>To schedule <span className="muted">{items.filter((i) => !i.date).length}</span></h3>
        <div className="muted" style={{ fontSize: 12 }}>Drag onto a day.</div>
        {items.filter((i) => !i.date).map((i) => chip(i, true))}
      </div>
      <div>
        <div className="row" style={{ justifyContent: "space-between", marginBottom: 6 }}>
          <h3>{month.toLocaleDateString("en-GB", { month: "long", year: "numeric" })}</h3>
          <div className="row"><button className="b" onClick={() => move(-1)}>‹</button><button className="b" onClick={() => move(1)}>›</button></div>
        </div>
        <div className="grid7">
          {days.map((d) => {
            const k = iso(d);
            return (
              <div key={k} className={`day${d.getMonth() !== month.getMonth() ? " out" : ""}${k === today ? " today" : ""}${over === k ? " over" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setOver(k); }} onDragLeave={() => setOver(null)} onDrop={drop(k)}>
                <span className="n">{d.getDate()}</span>
                {items.filter((i) => i.date === k).map((i) => chip(i))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function Inspect({ pick, snap, prefix, close, discuss, target }: {
  pick: Pick; snap: Snap; prefix: string; close: () => void;
  discuss: (expected: string, note: string) => Promise<unknown>; target: (op: string, value: string | null) => Promise<unknown>;
}) {
  const t = snap.targets[pick.key], d = snap.discussions[pick.key];
  const [expected, setExpected] = useState(""), [note, setNote] = useState("");
  const [op, setOp] = useState(t?.op ?? "min"), [tv, setTv] = useState(t ? String(t.value) : "");
  const [busy, setBusy] = useState(""), [err, setErr] = useState("");
  const run = (name: string, p: Promise<unknown>) => { setBusy(name); setErr(""); p.then(close, (e) => { setErr(String(e?.message ?? e)); setBusy(""); }); };
  return (
    <div className="skd-modal" onClick={close}>
      <div className="skd card" onClick={(e) => e.stopPropagation()} style={{ gap: 12 }}>
        <div><div className="muted" style={{ fontSize: 12 }}>{pick.label}</div><div style={{ fontSize: 26, fontWeight: 600 }}>{fmt(pick.value, pick.format)}</div></div>
        {pick.sources && <table><tbody>{Object.entries(pick.sources).map(([s, v]) => <tr key={s}><td>{s}</td><td className="num">{fmt(v, pick.format)}</td></tr>)}</tbody></table>}
        {pick.note && <div className="muted">{pick.note}</div>}
        {d && <div>Last discussion: <a href={`/${prefix}/issues/${d.identifier || d.issueId}`}>{d.identifier}</a> <span className="tag">{d.status}</span></div>}
        <div style={{ display: "grid", gap: 6 }}>
          <strong>Does this look wrong?</strong>
          <input placeholder="What do you see, or expect? e.g. 2 leads" value={expected} onChange={(e) => setExpected(e.target.value)} />
          <textarea rows={2} placeholder="Where you saw it, anything the agent should check" value={note} onChange={(e) => setNote(e.target.value)} />
          <div><button className="b p" disabled={!!busy || (!expected && !note)} onClick={() => run("d", discuss(expected, note))}>{busy === "d" ? "Sending…" : "Discuss with the agent"}</button></div>
        </div>
        {typeof pick.value === "number" && (
          <div className="row">
            <strong>Target</strong>
            <select value={op} onChange={(e) => setOp(e.target.value as "min" | "max")}><option value="min">at least</option><option value="max">at most</option></select>
            <input style={{ width: 110 }} inputMode="decimal" value={tv} onChange={(e) => setTv(e.target.value)} placeholder={pick.format === "pct" ? "0.05 = 5%" : ""} />
            <button className="b" disabled={!!busy || !tv} onClick={() => run("t", target(op, tv))}>Save</button>
            {t && <button className="b" disabled={!!busy} onClick={() => run("t", target(op, null))}>Clear</button>}
          </div>
        )}
        {err && <div className="down">{err}</div>}
      </div>
    </div>
  );
}

function Watch({ companyId, projectId, onEvent, onLost }: { companyId: string; projectId: string; onEvent: () => void; onLost: () => void }) {
  const stream = usePluginStream<unknown>(`project:${projectId}`, { companyId });
  useEffect(() => { if (stream.events.length) onEvent(); }, [stream.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stream.connected) onEvent(); else if (!stream.connecting) onLost(); }, [stream.connected, stream.connecting]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

export function ProjectDashboard({ context }: PluginDetailTabProps) {
  const companyId = context.companyId!, projectId = context.entityId, prefix = context.companyPrefix ?? "";
  const { data, refresh, error } = usePluginData<Snap>("dashboard", { companyId, projectId });
  const discussA = usePluginAction("discuss"), targetA = usePluginAction("target"), scheduleA = usePluginAction("schedule");
  const [pick, setPick] = useState<Pick | null>(null);
  const [attempt, setAttempt] = useState(0);
  const onLost = useCallback(() => { setTimeout(() => setAttempt((a) => a + 1), 3000); }, []);
  const schedule = useCallback((key: string, date: string | null) => { scheduleA({ companyId, projectId, key, date }).then(refresh, (e: unknown) => alert(String(e))); }, [scheduleA, companyId, projectId, refresh]);
  const watch = <Watch key={attempt} companyId={companyId} projectId={projectId} onEvent={refresh} onLost={onLost} />;
  const d = data?.dashboard;
  const widget = (w: Any, i: number): ReactNode => {
    const props = { w, snap: data!, open: setPick, prefix };
    const body = w.kind === "tiles" ? <Tiles {...props} /> : w.kind === "table" ? <Table {...props} /> : w.kind === "bars" ? <Bars {...props} />
      : w.kind === "series" ? <Series w={w} /> : w.kind === "calendar" ? <Calendar w={w} prefix={prefix} schedule={schedule} />
      : <div className="card" style={{ whiteSpace: "pre-wrap" }}>{w.text}</div>;
    return <div key={w.key ?? i} style={{ display: "grid", gap: 6 }}>{w.title && w.kind !== "tiles" && <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{w.title}</div>}{body}</div>;
  };
  const open = useMemo(() => Object.values(data?.discussions ?? {}).filter((x) => !["done", "cancelled", "deleted"].includes(x.status)).length, [data]);
  return (
    <div className="skd">
      <style>{CSS}</style>
      {watch}
      {error && <div className="down">{String(error.message ?? error)}</div>}
      {data && !d && <div className="card muted">No dashboard yet. Ask the project's agent to build one (tools dashboard_get / dashboard_update).</div>}
      {d && (
        <>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div><h3 style={{ fontSize: 18 }}>{d.title}</h3>
              <div className="muted" style={{ fontSize: 12 }}>Kept by the agent · updated {new Date(d.updatedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} · click any number to question it or set a target</div></div>
            <div className="row">
              {data!.offTarget.length > 0 && <span className="tag red">{data!.offTarget.length} off target</span>}
              {open > 0 && <span className="tag blue">{open} in discussion</span>}
            </div>
          </div>
          {d.sections.map((s: Any) => (
            <section key={s.id} style={{ display: "grid", gap: 10 }}>
              <div><h3>{s.title ?? s.id}</h3>{s.note && <div className="muted" style={{ fontSize: 13 }}>{s.note}</div>}</div>
              {s.widgets.map(widget)}
            </section>
          ))}
        </>
      )}
      {pick && data && <Inspect pick={pick} snap={data} prefix={prefix} close={() => setPick(null)}
        discuss={(expected, note) => discussA({ companyId, projectId, key: pick.key, shown: fmt(pick.value, pick.format), expected, note }).then(refresh)}
        target={(op, value) => targetA({ companyId, projectId, key: pick.key, op, value }).then(refresh)} />}
    </div>
  );
}
