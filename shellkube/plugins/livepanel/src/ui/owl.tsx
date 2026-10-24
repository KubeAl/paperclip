import { useEffect, useRef, useState } from "react";

type Submit = (m: { action: string; values: unknown; wake: boolean }) => Promise<unknown>;
type State = { values: Record<string, unknown>; owl: unknown };

// Served by the host from this plugin's dist/ui (build.mjs copies o-spreadsheet there). The static route needs the
// plugin's uuid: by key it fails (server bug, the uuid lookup error is not caught).
const src = fetch("/api/plugins", { credentials: "include" }).then((r) => r.json())
  .then((list: Array<{ id: string; pluginKey: string }>) => `/_plugins/${list.find((p) => p.pluginKey === "shellkube.livepanel")!.id}/ui/owl/index.html`);
const line = "1px solid var(--border)";
const button = { fontSize: 12, padding: "3px 10px", borderRadius: 6, border: line, background: "transparent", cursor: "pointer" } as const;

// Same sheet panel, rendered by Odoo's o-spreadsheet (OWL) for comparison with the HyperFormula grid.
// Opaque-origin frame: o-spreadsheet's Owl app and Bootstrap CSS stay out of the host page.
export function OwlSheet({ data, submit }: { data: unknown; submit: Submit }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const latest = useRef(data);
  latest.current = data;
  const waiting = useRef<((s: State) => void) | null>(null);
  const [msg, setMsg] = useState("");
  const [url, setUrl] = useState("");
  useEffect(() => { src.then(setUrl, (e) => setMsg(`Cannot load o-spreadsheet: ${e}`)); }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data ?? {};
      if (m.t === "ready") w.postMessage({ t: "load", data: latest.current }, "*");
      else if (m.t === "state") waiting.current?.(m);
      else if (m.t === "error") setMsg(String(m.error));
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

  const send = async (wake: boolean) => {
    const w = ref.current?.contentWindow;
    if (!w) return;
    const state = await new Promise<State>((resolve) => { waiting.current = resolve; w.postMessage({ t: "collect" }, "*"); });
    const n = (state.values.changes as unknown[]).length;
    setMsg(wake ? "Sending…" : "Saving…");
    try {
      await submit({ action: "sheet", values: { ...state.values, owl: state.owl }, wake });
      w.postMessage({ t: "saved" }, "*");
      setMsg(wake ? `Sent ${n} changes to the agent.` : "Saved.");
    } catch (e) { setMsg(`Not sent: ${e instanceof Error ? e.message : String(e)}`); }
  };

  return (
    <div style={{ display: "grid", gap: 6 }}>
      <iframe ref={ref} title="Spreadsheet (o-spreadsheet)" src={url || undefined} sandbox="allow-scripts allow-downloads" allow="clipboard-read; clipboard-write"
        style={{ display: "block", width: "100%", height: 560, border: line, borderRadius: 4 }} />
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button style={button} onClick={() => send(false)}>Save</button>
        <button style={{ ...button, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }} onClick={() => send(true)}>Send to agent</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{msg}</span>
      </div>
    </div>
  );
}
