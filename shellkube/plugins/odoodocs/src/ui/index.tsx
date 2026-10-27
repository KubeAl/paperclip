import { useCallback, useEffect, useState, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePluginAction, usePluginData, usePluginStream, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { pluginId } from "./docs";

type FileRow = { id: number; name: string; mimetype: string; size: number; version: number; version_id: number; locked: boolean;
  editors: Array<{ id: number; name: string }>; write_date: string; author_name: string; odoo_url: string };
type Version = { id: number; version: number; author: string; source: string; note: string; create_date: string; size: number };
type Link = { taskId: number | null; odooUrl: string; docsUrl: string };
type Ctx = { companyId: string; issueId: string; plugin: string; reload: () => void };

const SLOT = "shellkube.odoodocs:files";
const line = "1px solid var(--border)";
const btn = { fontSize: 12, padding: "2px 8px", borderRadius: 6, border: line, background: "transparent", cursor: "pointer", color: "inherit", textDecoration: "none" } as const;
const field = { fontSize: 12, padding: "2px 6px", border: line, borderRadius: 6, background: "transparent", color: "inherit" } as const;
const muted = { fontSize: 12, opacity: 0.7 } as const;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Odoo sends UTC datetimes as "YYYY-MM-DD HH:MM:SS".
const when = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z").toLocaleString();
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
const BLANK = [["docx", "Document"], ["xlsx", "Spreadsheet"], ["pptx", "Presentation"]];

export function FilesTab({ context }: PluginDetailTabProps) {
  if (!context.companyId) return null;
  return <Files companyId={context.companyId} issueId={context.entityId} />;
}

// A small form row: busy state, error line, and an optional result line.
function useRun() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }, []);
  const errorLine = error ? <p role="alert" style={{ fontSize: 12, color: "var(--destructive, #dc2626)", margin: "4px 0 0" }}>{error}</p> : null;
  return { busy, run, errorLine, setError };
}
function Form({ onSubmit, busy, children, style }: { onSubmit: () => void; busy: boolean; children: ReactNode; style?: CSSProperties }) {
  const submit = (e: FormEvent) => { e.preventDefault(); if (!busy) onSubmit(); };
  return <form onSubmit={submit} style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginTop: 6, ...style }}>{children}</form>;
}

// Odoo pushes file events (webhook -> plugin stream). usePluginStream does not reconnect by itself, so remount after a loss.
function Watch({ companyId, issueId, onEvent }: { companyId: string; issueId: string; onEvent: () => void }) {
  const [attempt, setAttempt] = useState(0);
  return <Stream key={attempt} companyId={companyId} issueId={issueId} onEvent={onEvent} onLost={() => setTimeout(() => setAttempt((a) => a + 1), 3000)} />;
}
function Stream({ companyId, issueId, onEvent, onLost }: { companyId: string; issueId: string; onEvent: () => void; onLost: () => void }) {
  const stream = usePluginStream<{ event: string }>(`files:${issueId}`, { companyId });
  useEffect(() => { if (stream.events.length) onEvent(); }, [stream.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!stream.connected && !stream.connecting) onLost(); }, [stream.connected, stream.connecting]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Files({ companyId, issueId }: { companyId: string; issueId: string }) {
  const { data: link, refresh: refreshLink, error: linkError } = usePluginData<Link>("link", { companyId, issueId });
  const call = { list: usePluginAction("list"), link: usePluginAction("link"), unlink: usePluginAction("unlink"), create: usePluginAction("create") };
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [taskInput, setTaskInput] = useState("");
  const [open, setOpen] = useState<FileRow | null>(null);
  const [form, setForm] = useState<"" | "new" | "request">("");
  const [plugin, setPlugin] = useState("");
  const { busy, run, errorLine, setError } = useRun();
  useEffect(() => { pluginId().then(setPlugin, () => undefined); }, []);

  const load = useCallback(async () => {
    const r = (await call.list({ companyId, issueId })) as { files: FileRow[] };
    setFiles(r.files);
  }, [call.list, companyId, issueId]);
  const reload = useCallback(() => { load().catch((e) => setError(msg(e))); }, [load, setError]);
  useEffect(() => { if (link?.taskId) run(load); }, [link?.taskId, load, run]);

  // Show this tab by itself once per browser session on tasks that have Odoo files.
  useEffect(() => {
    const seen = `odoodocs-opened:${issueId}`;
    if (!link?.taskId || sessionStorage.getItem(seen)) return;
    sessionStorage.setItem(seen, "1");
    window.dispatchEvent(new CustomEvent("paperclip:open-plugin-tab", { detail: { issueId, slot: SLOT } }));
  }, [link?.taskId, issueId]);

  if (linkError) return <p role="alert" style={muted}>{linkError.message}</p>;
  if (!link) return <p style={muted}>Loading…</p>;

  if (!link.taskId) return (
    <Form busy={busy} style={{ marginTop: 0 }} onSubmit={() => run(async () => { await call.link({ companyId, issueId, taskId: Number(taskInput) }); refreshLink(); })}>
      <label htmlFor="odoodocs-task" style={{ fontSize: 13 }}>Odoo task id</label>
      <input id="odoodocs-task" inputMode="numeric" pattern="[0-9]+" required value={taskInput} onChange={(e) => setTaskInput(e.target.value)} style={{ ...field, width: 90 }} />
      <button type="submit" style={btn} disabled={busy}>Link</button>
      {errorLine}
    </Form>
  );

  const upload = (f: File) => run(async () => {
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    await call.create({ companyId, issueId, name: f.name, contentB64: b64, note: "uploaded from Paperclip" });
    await load();
  });
  const ctx: Ctx = { companyId, issueId, plugin, reload };
  const toggle = (f: "new" | "request") => setForm(form === f ? "" : f);

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <Watch companyId={companyId} issueId={issueId} onEvent={reload} />
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13, flexWrap: "wrap" }}>
        <a href={`${link.odooUrl}/odoo/project.task/${link.taskId}`} target="_blank" rel="noreferrer">Open task #{link.taskId} in Odoo</a>
        <span style={{ marginLeft: "auto" }} />
        <button style={btn} aria-expanded={form === "new"} onClick={() => toggle("new")}>New</button>
        <label style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
          Upload<input type="file" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
        </label>
        <button style={btn} aria-expanded={form === "request"} onClick={() => toggle("request")}>Request a file</button>
        <button style={btn} disabled={busy} onClick={() => run(load)} aria-label="Refresh files">↻</button>
        <button style={btn} disabled={busy}
          onClick={() => { if (confirm("Unlink this Odoo task? The files stay in Odoo.")) run(async () => { await call.unlink({ companyId, issueId }); setFiles(null); refreshLink(); }); }}>
          Unlink
        </button>
      </div>
      {form === "new" && <NewFile ctx={ctx} done={() => { setForm(""); reload(); }} />}
      {form === "request" && <RequestFile ctx={ctx} />}
      {errorLine}
      {files === null ? <p style={muted}>Loading files…</p> : !files.length ? <p style={muted}>No files on this Odoo task yet.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {files.map((f) => <FileItem key={f.id} f={f} ctx={ctx} onOpen={() => setOpen(f)} />)}
        </ul>
      )}
      {open && plugin && <EditorModal file={open} ctx={ctx} onClose={() => { setOpen(null); reload(); }} />}
    </div>
  );
}

function NewFile({ ctx, done }: { ctx: Ctx; done: () => void }) {
  const templatesAction = usePluginAction("templates"), create = usePluginAction("create");
  const [templates, setTemplates] = useState<Array<{ id: number; name: string }>>([]);
  const [kind, setKind] = useState("docx");
  const [name, setName] = useState("");
  const { busy, run, errorLine } = useRun();
  useEffect(() => { run(async () => setTemplates(((await templatesAction({ companyId: ctx.companyId })) as { templates: Array<{ id: number; name: string }> }).templates)); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const template = templates.find((t) => `t${t.id}` === kind);
  // A template keeps its own extension; a blank file gets the chosen one.
  const ext = template ? template.name.split(".").pop() : kind;
  const fullName = name.trim() && (name.trim().toLowerCase().endsWith(`.${ext}`) ? name.trim() : `${name.trim()}.${ext}`);
  return (
    <div>
      <Form busy={busy} onSubmit={() => run(async () => { await create({ companyId: ctx.companyId, issueId: ctx.issueId, name: fullName, templateId: template?.id }); done(); })}>
        <select aria-label="Kind" value={kind} onChange={(e) => setKind(e.target.value)} style={field}>
          {BLANK.map(([k, label]) => <option key={k} value={k}>Blank {label.toLowerCase()} (.{k})</option>)}
          {templates.map((t) => <option key={t.id} value={`t${t.id}`}>Template: {t.name}</option>)}
        </select>
        <input aria-label="File name" placeholder="File name" required value={name} onChange={(e) => setName(e.target.value)} style={{ ...field, flex: 1, minWidth: 120 }} />
        <button type="submit" style={btn} disabled={busy}>Create</button>
      </Form>
      {errorLine}
    </div>
  );
}

function RequestFile({ ctx }: { ctx: Ctx }) {
  const request = usePluginAction("request");
  const [v, setV] = useState({ name: "", who: "user", target: "", deadline: "", note: "" });
  const [url, setUrl] = useState("");
  const { busy, run, errorLine } = useRun();
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const send = () => run(async () => {
    const r = (await request({ companyId: ctx.companyId, issueId: ctx.issueId, name: v.name, note: v.note, deadline: v.deadline,
      ...(v.who === "user" ? { userLogin: v.target } : { partnerEmail: v.target }) })) as { upload_url: string };
    setUrl(r.upload_url);
  });
  return (
    <div>
      <Form busy={busy} onSubmit={send}>
        <input aria-label="What file" placeholder="What file (e.g. Signed contract)" required value={v.name} onChange={set("name")} style={{ ...field, flex: 1, minWidth: 140 }} />
        <select aria-label="From" value={v.who} onChange={set("who")} style={field}>
          <option value="user">Odoo user (login)</option><option value="email">Contact (email)</option>
        </select>
        <input aria-label={v.who === "user" ? "Login" : "Email"} required value={v.target} onChange={set("target")} style={{ ...field, minWidth: 140 }} />
        <label style={muted}>Due <input type="date" value={v.deadline} onChange={set("deadline")} style={field} /></label>
        <input aria-label="Note" placeholder="Note (optional)" value={v.note} onChange={set("note")} style={{ ...field, flex: 1, minWidth: 140 }} />
        <button type="submit" style={btn} disabled={busy}>Send request</button>
      </Form>
      {url && <CopyLine label="Upload link" url={url} />}
      {errorLine}
    </div>
  );
}

function CopyLine({ label, url }: { label: string; url: string }) {
  return (
    <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4, fontSize: 12 }}>
      <span style={muted}>{label}</span>
      <input readOnly aria-label={label} value={url} onFocus={(e) => e.target.select()} style={{ ...field, flex: 1 }} />
      <button style={btn} onClick={() => navigator.clipboard.writeText(url)}>Copy</button>
    </div>
  );
}

function FileItem({ f, ctx, onOpen }: { f: FileRow; ctx: Ctx; onOpen: () => void }) {
  const call = { versions: usePluginAction("versions"), pdf: usePluginAction("export-pdf") };
  const [panel, setPanel] = useState<"" | "versions" | "share" | "ask">("");
  const [versions, setVersions] = useState<Version[]>([]);
  const [note, setNote] = useState("");
  const { busy, run, errorLine } = useRun();
  const show = (p: typeof panel) => setPanel(panel === p ? "" : p);
  const toggleVersions = () => {
    if (panel === "versions") return setPanel("");
    run(async () => { setVersions(((await call.versions({ companyId: ctx.companyId, fileId: f.id })) as { versions: Version[] }).versions); setPanel("versions"); });
  };
  const pdf = () => run(async () => { await call.pdf({ companyId: ctx.companyId, fileId: f.id }); setNote(`PDF saved in Odoo.`); ctx.reload(); });
  return (
    <li style={{ border: line, borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{f.name}</strong>
        <span style={muted}>v{f.version} · {kb(f.size)}</span>
        {f.locked && <span style={{ fontSize: 11, padding: "0 6px", borderRadius: 9, background: "var(--accent)" }}
          title="Open in the editor">editing: {f.editors.map((e) => e.name).join(", ") || "locked"}</span>}
      </div>
      <div style={{ ...muted, marginTop: 2 }}>{f.author_name} · {when(f.write_date)}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <button style={btn} onClick={onOpen} disabled={!ctx.plugin}>Open</button>
        {ctx.plugin && <a style={btn} target="_blank" rel="noreferrer" href={editorUrl(ctx, f.id)}>New tab</a>}
        <button style={btn} onClick={toggleVersions} aria-expanded={panel === "versions"}>Versions</button>
        {f.mimetype !== "application/pdf" && <button style={btn} onClick={pdf} disabled={busy}>PDF</button>}
        <button style={btn} onClick={() => show("share")} aria-expanded={panel === "share"}>Share</button>
        <button style={btn} onClick={() => show("ask")} aria-expanded={panel === "ask"}>Ask an agent</button>
        <a style={btn} href={f.odoo_url} target="_blank" rel="noreferrer">Odoo</a>
      </div>
      {note && <p style={{ ...muted, margin: "4px 0 0" }}>{note}</p>}
      {errorLine}
      {panel === "versions" && (
        <ol reversed style={{ fontSize: 12, margin: "6px 0 0", paddingLeft: 20 }}>
          {[...versions].sort((a, b) => b.version - a.version).map((v) => (
            <li key={v.id}>v{v.version} · {v.author} · {v.source} · {when(v.create_date)}{v.note ? ` · ${v.note}` : ""}</li>
          ))}
        </ol>
      )}
      {panel === "share" && <Share f={f} ctx={ctx} />}
      {panel === "ask" && <Ask f={f} ctx={ctx} done={() => { setPanel(""); setNote("Sent. The agent was woken on this task."); }} />}
    </li>
  );
}

function Share({ f, ctx }: { f: FileRow; ctx: Ctx }) {
  const share = usePluginAction("share");
  const [expires, setExpires] = useState("");
  const [password, setPassword] = useState("");
  const [url, setUrl] = useState("");
  const { busy, run, errorLine } = useRun();
  return (
    <div>
      <Form busy={busy} onSubmit={() => run(async () => setUrl(((await share({ companyId: ctx.companyId, fileId: f.id, expires, password })) as { url: string }).url))}>
        <label style={muted}>Expires <input type="date" value={expires} onChange={(e) => setExpires(e.target.value)} style={field} /></label>
        <input type="password" aria-label="Password (optional)" placeholder="Password (optional)" autoComplete="new-password" value={password}
          onChange={(e) => setPassword(e.target.value)} style={field} />
        <button type="submit" style={btn} disabled={busy}>Create link</button>
      </Form>
      {url && <CopyLine label="Public link" url={url} />}
      {errorLine}
    </div>
  );
}

function Ask({ f, ctx, done }: { f: FileRow; ctx: Ctx; done: () => void }) {
  const { data: agents } = usePluginData<Array<{ id: string; name: string }>>("agents", { companyId: ctx.companyId });
  const ask = usePluginAction("ask");
  const [agentId, setAgentId] = useState("");
  const [request, setRequest] = useState("");
  const { busy, run, errorLine } = useRun();
  const agent = agentId || agents?.[0]?.id || "";
  return (
    <div>
      <Form busy={busy} style={{ alignItems: "flex-start" }} onSubmit={() => run(async () => {
        await ask({ companyId: ctx.companyId, issueId: ctx.issueId, agentId: agent, request, fileId: f.id, name: f.name, version: f.version, versionId: f.version_id });
        done();
      })}>
        <select aria-label="Agent" value={agent} onChange={(e) => setAgentId(e.target.value)} style={field}>
          {(agents ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </select>
        <textarea aria-label={`Request about ${f.name}`} placeholder={`What should the agent do with ${f.name}?`} required rows={2} value={request}
          onChange={(e) => setRequest(e.target.value)} style={{ ...field, flex: 1, minWidth: 180, fontFamily: "inherit" }} />
        <button type="submit" style={btn} disabled={busy || !agent}>Send</button>
      </Form>
      <p style={{ ...muted, margin: "2px 0 0" }}>Assigns this task to the agent and wakes it.</p>
      {errorLine}
    </div>
  );
}

const editorUrl = (ctx: Ctx, fileId: number) => `/_plugins/${ctx.plugin}/ui/editor/index.html?company=${ctx.companyId}&file=${fileId}`;

// The editor runs in its own page (the "New tab" page) inside a frame: each open gets a fresh api.js, so a second
// editor in the same Paperclip page draws like the first (a second DocEditor in one page drew black sheet headers).
function EditorModal({ file, ctx, onClose }: { file: FileRow; ctx: Ctx; onClose: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={file.name}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center" }}>
      <div style={{ width: "calc(100vw - 2rem)", height: "calc(100vh - 2rem)", background: "var(--background, #fff)", borderRadius: 8,
        display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: line, fontSize: 13 }}>
          <strong style={{ fontWeight: 600 }}>{file.name}</strong>
          <button style={{ ...btn, marginLeft: "auto" }} onClick={onClose} autoFocus>Close</button>
        </div>
        <iframe title={file.name} src={editorUrl(ctx, file.id)} allow="clipboard-read; clipboard-write; fullscreen"
          style={{ flex: 1, minHeight: 0, border: 0, background: "#fff" }} />
      </div>
    </div>,
    document.body,
  );
}
