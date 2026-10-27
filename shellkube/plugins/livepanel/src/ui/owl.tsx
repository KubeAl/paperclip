import { useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

type Submit = (m: { action: string; values: unknown; wake: boolean }) => Promise<unknown>;
type State = { values: Record<string, unknown>; owl: unknown };
// The Odoo file this sheet was loaded from (live-panel sheet --odoo-file/--odoo-base) or last saved to.
export type OdooSource = { fileId: number; versionId: number };
type Odoo = { companyId: string; issueId: string; source?: OdooSource };
type OdooResult = { status: string; id?: number; version_id?: number; version?: number; current_version?: number; editors?: Array<{ name: string }> };

// Calls the Odoo documents plugin as the signed-in person (its actions carry the host-verified user).
async function odoodocs<T>(kind: "data" | "actions", key: string, companyId: string, params: Record<string, unknown>): Promise<T> {
  const r = await fetch(`/api/plugins/shellkube.odoodocs/${kind}/${key}`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyId, params }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.message ?? body.error ?? `HTTP ${r.status}`);
  return body.data;
}

// Served by the host from this plugin's dist/ui (build.mjs copies o-spreadsheet there). The static route needs the
// plugin's uuid: by key it fails (server bug, the uuid lookup error is not caught).
const pluginId = fetch("/api/plugins", { credentials: "include" }).then((r) => r.json())
  .then((list: Array<{ id: string; pluginKey: string }>) => list.find((p) => p.pluginKey === "shellkube.livepanel")!.id);
export const frameUrl = (dir: string) => pluginId.then((id) => `/_plugins/${id}/ui/${dir}/index.html`);
const line = "1px solid var(--border)";
const button = { fontSize: 12, padding: "3px 10px", borderRadius: 6, border: line, background: "transparent", cursor: "pointer" } as const;

// Height that lets `ref`'s panel section fill the visible side panel tab (the tab body scrolls, so it has no height to inherit).
export function useFillHeight(ref: RefObject<HTMLElement | null>, fallback: number) {
  const [height, setHeight] = useState(fallback);
  useLayoutEffect(() => {
    const el = ref.current, view = el?.closest<HTMLElement>("[data-side-panel-content-viewport]"), section = el?.closest("section");
    if (!el || !view || !section) return;
    const fit = () => {
      const s = getComputedStyle(view);
      const room = view.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
      setHeight(Math.max(320, room - (section.offsetHeight - el.offsetHeight)));
    };
    // The section is observed too: it is 0 px while the tab is hidden and gets its real size when shown.
    const ro = new ResizeObserver(fit);
    ro.observe(view); ro.observe(section);
    return () => ro.disconnect();
  }, [ref]);
  return height;
}

// Same sheet panel, rendered by Odoo's o-spreadsheet (OWL) for comparison with the HyperFormula grid.
// Opaque-origin frame: o-spreadsheet's Owl app and Bootstrap CSS stay out of the host page.
export function OwlSheet({ data, name, submit, odoo }: { data: unknown; name: string; submit: Submit; odoo: Odoo }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const latest = useRef({ data, name });
  latest.current = { data, name };
  const waiting = useRef<((s: State) => void) | null>(null);
  const xlsx = useRef<((b64: string) => void) | null>(null);
  const [linked, setLinked] = useState(false);
  const source = useRef(odoo.source);
  useEffect(() => {
    odoodocs<{ taskId: number | null }>("data", "link", odoo.companyId, { issueId: odoo.issueId })
      .then((l) => setLinked(!!l.taskId), () => setLinked(false));
  }, [odoo.companyId, odoo.issueId]);
  const [msg, setMsg] = useState("");
  const [url, setUrl] = useState("");
  const height = useFillHeight(ref, 560);
  useEffect(() => { frameUrl("owl").then(setUrl, (e) => setMsg(`Cannot load o-spreadsheet: ${e}`)); }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data ?? {};
      if (m.t === "ready") w.postMessage({ t: "load", ...latest.current }, "*");
      else if (m.t === "state") waiting.current?.(m);
      else if (m.t === "xlsx") xlsx.current?.(m.b64);
      else if (m.t === "error") setMsg(String(m.error));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const collect = (w: Window) => new Promise<State>((resolve) => { waiting.current = resolve; w.postMessage({ t: "collect" }, "*"); });
  const send = async (wake: boolean) => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    const state = await collect(w);
    const n = (state.values.changes as unknown[]).length;
    setMsg(wake ? "Sending…" : "Saving…");
    try {
      await submit({ action: "sheet", values: { ...state.values, owl: state.owl }, wake });
      w.postMessage({ t: "saved" }, "*");
      setMsg(wake ? `Sent ${n} changes to the agent.` : "Saved.");
    } catch (e) { setMsg(`Not sent: ${e instanceof Error ? e.message : String(e)}`); }
  };

  // Saves the sheet as .xlsx into the linked Odoo task: a new version of its source file, else a new file. The panel
  // is saved too (with the new source), so the next save, also after a reload, builds on this version.
  const saveToOdoo = async () => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    setMsg("Saving to Odoo…");
    try {
      const [state, contentB64] = await Promise.all([collect(w),
        new Promise<string>((resolve) => { xlsx.current = resolve; w.postMessage({ t: "xlsx" }, "*"); })]);
      const note = "saved from the live panel", s = source.current, { companyId, issueId } = odoo;
      const r = s
        ? await odoodocs<OdooResult>("actions", "write", companyId, { fileId: s.fileId, contentB64, baseVersionId: s.versionId, note })
        : await odoodocs<OdooResult>("actions", "create", companyId, { issueId, name: `${name.replace(/\.xlsx$/i, "")}.xlsx`, contentB64, note });
      if (r.status === "CONFLICT") return setMsg(`Not saved: version ${r.current_version} was saved in Odoo after this sheet was loaded.`);
      if (r.status === "LOCKED") return setMsg(`Not saved: ${r.editors?.map((e) => e.name).join(", ") || "someone"} has the file open in Odoo.`);
      source.current = { fileId: s?.fileId ?? r.id!, versionId: r.version_id! };
      await submit({ action: "sheet", values: { ...state.values, owl: state.owl, odoo: source.current }, wake: false });
      w.postMessage({ t: "saved" }, "*");
      setMsg(`Saved to Odoo as v${r.version}.`);
    } catch (e) { setMsg(`Not saved: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <iframe ref={ref} title="Spreadsheet (o-spreadsheet)" src={url || undefined} sandbox="allow-scripts allow-downloads" allow="clipboard-read; clipboard-write"
        style={{ display: "block", width: "100%", height, border: line, borderRadius: 4 }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button style={button} onClick={() => send(false)}>Save</button>
        {linked && <button style={button} onClick={saveToOdoo}>Save to Odoo task</button>}
        <button style={{ ...button, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }} onClick={() => send(true)}>Send to agent</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{msg}</span>
      </div>
    </div>
  );
}
