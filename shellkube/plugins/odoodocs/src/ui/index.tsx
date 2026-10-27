import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePluginAction, usePluginData, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { mountEditor, pluginId } from "./docs";

type FileRow = { id: number; name: string; mimetype: string; size: number; version: number; version_id: number; locked: boolean;
  editors: Array<{ id: number; name: string }>; write_date: string; write_uid_name: string; odoo_url: string };
type Version = { id: number; version: number; author: string; source: string; note: string; create_date: string; size: number };
type Link = { taskId: number | null; odooUrl: string; docsUrl: string };

const POLL_MS = 30_000;
const line = "1px solid var(--border)";
const btn = { fontSize: 12, padding: "2px 8px", borderRadius: 6, border: line, background: "transparent", cursor: "pointer", color: "inherit" } as const;
const muted = { fontSize: 12, opacity: 0.7 } as const;
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
// Odoo sends UTC datetimes as "YYYY-MM-DD HH:MM:SS".
const when = (s: string) => new Date(/[zZ]|[+-]\d\d:\d\d$/.test(s) ? s : s.replace(" ", "T") + "Z").toLocaleString();
const kb = (n: number) => (n > 1e6 ? `${(n / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);

export function FilesTab({ context }: PluginDetailTabProps) {
  if (!context.companyId) return null;
  return <Files companyId={context.companyId} issueId={context.entityId} />;
}

function Files({ companyId, issueId }: { companyId: string; issueId: string }) {
  const { data: link, refresh: refreshLink, error: linkError } = usePluginData<Link>("link", { companyId, issueId });
  const call = { list: usePluginAction("list"), link: usePluginAction("link"), unlink: usePluginAction("unlink"), upload: usePluginAction("upload") };
  const [files, setFiles] = useState<FileRow[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [taskInput, setTaskInput] = useState("");
  const [open, setOpen] = useState<FileRow | null>(null);
  const [plugin, setPlugin] = useState("");
  useEffect(() => { pluginId().then(setPlugin, () => undefined); }, []);

  const run = useCallback(async (fn: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await fn(); } catch (e) { setError(msg(e)); } finally { setBusy(false); }
  }, []);
  const load = useCallback(async () => {
    const r = (await call.list({ companyId, issueId })) as { files: FileRow[] };
    setFiles(r.files);
  }, [call.list, companyId, issueId]);

  // Odoo has no push to Paperclip in Phase 1: poll while the tab is visible.
  useEffect(() => {
    if (!link?.taskId) return;
    run(load);
    const t = setInterval(() => { if (document.visibilityState === "visible") load().catch((e) => setError(msg(e))); }, POLL_MS);
    return () => clearInterval(t);
  }, [link?.taskId, load, run]);

  if (linkError) return <p role="alert" style={muted}>{linkError.message}</p>;
  if (!link) return <p style={muted}>Loading…</p>;
  const errorLine = error && <p role="alert" style={{ fontSize: 12, color: "var(--destructive, #dc2626)", margin: "6px 0" }}>{error}</p>;

  if (!link.taskId) return (
    <form style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}
      onSubmit={(e) => { e.preventDefault(); run(async () => { await call.link({ companyId, issueId, taskId: Number(taskInput) }); refreshLink(); }); }}>
      <label htmlFor="odoodocs-task" style={{ fontSize: 13 }}>Odoo task id</label>
      <input id="odoodocs-task" inputMode="numeric" pattern="[0-9]+" required value={taskInput} onChange={(e) => setTaskInput(e.target.value)}
        style={{ width: 90, fontSize: 13, padding: "2px 6px", border: line, borderRadius: 6, background: "transparent", color: "inherit" }} />
      <button type="submit" style={btn} disabled={busy}>Link</button>
      {errorLine}
    </form>
  );

  const upload = (f: File) => run(async () => {
    const b64 = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    await call.upload({ companyId, issueId, name: f.name, contentB64: b64 });
    await load();
  });

  return (
    <div style={{ display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 13 }}>
        <a href={`${link.odooUrl}/odoo/project.task/${link.taskId}`} target="_blank" rel="noreferrer">Odoo task #{link.taskId}</a>
        <span style={{ marginLeft: "auto" }} />
        <label style={{ ...btn, opacity: busy ? 0.5 : 1 }}>
          Upload<input type="file" hidden disabled={busy} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) upload(f); }} />
        </label>
        <button style={btn} disabled={busy} onClick={() => run(load)} aria-label="Refresh files">↻</button>
        <button style={btn} disabled={busy}
          onClick={() => { if (confirm("Unlink this Odoo task? The files stay in Odoo.")) run(async () => { await call.unlink({ companyId, issueId }); setFiles(null); refreshLink(); }); }}>
          Unlink
        </button>
      </div>
      {errorLine}
      {files === null ? <p style={muted}>Loading files…</p> : !files.length ? <p style={muted}>No files on this Odoo task yet.</p> : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
          {files.map((f) => <FileItem key={f.id} f={f} companyId={companyId} plugin={plugin} onOpen={() => setOpen(f)} />)}
        </ul>
      )}
      {open && <EditorModal file={open} companyId={companyId} onClose={() => { setOpen(null); load().catch((e) => setError(msg(e))); }} />}
    </div>
  );
}

function FileItem({ f, companyId, plugin, onOpen }: { f: FileRow; companyId: string; plugin: string; onOpen: () => void }) {
  const versionsAction = usePluginAction("versions");
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [error, setError] = useState("");
  const toggle = () => {
    if (versions) return setVersions(null);
    versionsAction({ companyId, fileId: f.id }).then((r) => setVersions((r as { versions: Version[] }).versions), (e) => setError(msg(e)));
  };
  return (
    <li style={{ border: line, borderRadius: 8, padding: "6px 8px" }}>
      <div style={{ display: "flex", gap: 6, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13, fontWeight: 600, overflowWrap: "anywhere" }}>{f.name}</strong>
        <span style={muted}>v{f.version} · {kb(f.size)}</span>
        {f.locked && <span style={{ fontSize: 11, padding: "0 6px", borderRadius: 9, background: "var(--accent)" }}
          title="Open in the editor">editing: {f.editors.map((e) => e.name).join(", ") || "locked"}</span>}
      </div>
      <div style={{ ...muted, marginTop: 2 }}>{f.write_uid_name} · {when(f.write_date)}</div>
      <div style={{ display: "flex", gap: 6, marginTop: 4, flexWrap: "wrap" }}>
        <button style={btn} onClick={onOpen}>Open</button>
        {plugin && <a style={{ ...btn, textDecoration: "none" }} target="_blank" rel="noreferrer"
          href={`/_plugins/${plugin}/ui/editor/index.html?company=${companyId}&file=${f.id}`}>New tab</a>}
        <button style={btn} onClick={toggle} aria-expanded={!!versions}>Versions</button>
        <a style={{ ...btn, textDecoration: "none" }} href={f.odoo_url} target="_blank" rel="noreferrer">Odoo</a>
      </div>
      {error && <p role="alert" style={{ fontSize: 12, margin: "4px 0 0" }}>{error}</p>}
      {versions && (
        <ol reversed style={{ fontSize: 12, margin: "6px 0 0", paddingLeft: 20 }}>
          {[...versions].sort((a, b) => b.version - a.version).map((v) => (
            <li key={v.id}>v{v.version} · {v.author} · {v.source} · {when(v.create_date)}{v.note ? ` · ${v.note}` : ""}</li>
          ))}
        </ol>
      )}
    </li>
  );
}

function EditorModal({ file, companyId, onClose }: { file: FileRow; companyId: string; onClose: () => void }) {
  const editorConfig = usePluginAction("editor-config");
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let editor: { destroyEditor(): void } | undefined, gone = false;
    editorConfig({ companyId, fileId: file.id })
      .then((r) => (gone ? undefined : mountEditor(ref.current!, r as Parameters<typeof mountEditor>[1])))
      .then((e) => { editor = e; if (gone) e?.destroyEditor(); }, (e) => setError(msg(e)));
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", esc);
    return () => { gone = true; editor?.destroyEditor(); window.removeEventListener("keydown", esc); };
  }, [file.id]);
  return createPortal(
    <div role="dialog" aria-modal="true" aria-label={file.name}
      style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(0,0,0,.5)", display: "grid", placeItems: "center" }}>
      <div style={{ width: "calc(100vw - 2rem)", height: "calc(100vh - 2rem)", background: "var(--background, #fff)", borderRadius: 8,
        display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px", borderBottom: line, fontSize: 13 }}>
          <strong style={{ fontWeight: 600 }}>{file.name}</strong>
          <button style={{ ...btn, marginLeft: "auto" }} onClick={onClose} autoFocus>Close</button>
        </div>
        {error && <p role="alert" style={{ padding: 12 }}>{error}</p>}
        {/* api.js replaces this div's content with the editor iframe, so React renders nothing inside it. */}
        <div ref={ref} style={{ flex: 1, minHeight: 0 }} />
      </div>
    </div>,
    document.body,
  );
}
