import { useCallback, useEffect, useRef, useState } from "react";
import { usePluginAction, usePluginData, usePluginStream, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { SRCDOC } from "./frame";

type Op = { target?: string; mode?: string; html?: string };
type PanelState = {
  name: string; title: string; html: string; patches: Op[]; data: Record<string, unknown>;
  version: number; rev: number; updatedAt: string;
};

const MAX_HEIGHT = 1200;
const isDark = () => document.documentElement.classList.contains("dark");

function Frame({ panel, submit }: {
  panel: PanelState;
  submit: (m: { action: string; values: unknown; wake: boolean }) => Promise<unknown>;
}) {
  const ref = useRef<HTMLIFrameElement>(null);
  // What the frame has applied so far: render version, patch count, data json, newest rev seen.
  const shown = useRef({ ready: false, version: -1, patches: 0, data: "", rev: -1 });
  const latest = useRef(panel);
  const [height, setHeight] = useState(80);

  const sync = useCallback(() => {
    const p = latest.current, s = shown.current, w = ref.current?.contentWindow;
    if (!w || !s.ready) return;
    if (s.version !== p.version) {
      w.postMessage({ t: "render", html: p.html, theme: isDark() ? "dark" : "light" }, "*");
      s.version = p.version; s.patches = 0;
    }
    if (p.patches.length > s.patches) {
      w.postMessage({ t: "patch", ops: p.patches.slice(s.patches) }, "*");
      s.patches = p.patches.length;
    }
    const data = JSON.stringify(p.data);
    if (data !== s.data) { w.postMessage({ t: "data", data: p.data }, "*"); s.data = data; }
  }, []);

  useEffect(() => {
    // Refreshes can answer out of order; never step back to an older state.
    if (panel.rev < shown.current.rev) return;
    shown.current.rev = panel.rev; latest.current = panel; sync();
  }, [panel, sync]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data ?? {};
      if (m.t === "ready") {
        shown.current = { ...shown.current, ready: true, version: -1, patches: 0, data: "" };
        sync();
      } else if (m.t === "height") {
        setHeight(Math.min(MAX_HEIGHT, Math.max(24, Number(m.h) || 0)));
      } else if (m.t === "open") {
        if (/^https?:\/\//i.test(String(m.url))) window.open(String(m.url), "_blank", "noopener,noreferrer");
      } else if (m.t === "submit") {
        submit({ action: String(m.action ?? "submit"), values: m.values ?? {}, wake: m.wake !== false }).then(
          () => w.postMessage({ t: "ack", id: m.id, ok: true }, "*"),
          (err: unknown) => w.postMessage({ t: "ack", id: m.id, ok: false, error: err instanceof Error ? err.message : String(err) }, "*"),
        );
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [submit, sync]);

  return (
    <iframe ref={ref} title={panel.title || panel.name} srcDoc={SRCDOC} sandbox="allow-scripts" referrerPolicy="no-referrer"
      style={{ display: "block", width: "100%", height, border: 0, colorScheme: isDark() ? "dark" : "light" }} />
  );
}

function Panels({ companyId, issueId, onLost }: { companyId: string; issueId: string; onLost: () => void }) {
  const { data, refresh } = usePluginData<PanelState[]>("panels", { companyId, issueId });
  const stream = usePluginStream<{ panel: string }>(`issue:${issueId}`, { companyId });
  const action = usePluginAction("submit");

  useEffect(() => { if (stream.events.length) refresh(); }, [stream.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (stream.connected) refresh(); }, [stream.connected]); // eslint-disable-line react-hooks/exhaustive-deps
  // usePluginStream never reconnects by itself (error, server restart, plugin reload): remount after a pause.
  useEffect(() => { if (!stream.connected && !stream.connecting) onLost(); }, [stream.connected, stream.connecting, onLost]);

  const submitFor = useCallback((panel: string) =>
    (m: { action: string; values: unknown; wake: boolean }) => action({ companyId, issueId, panel, ...m }), [action, companyId, issueId]);

  if (!data?.length) return <span data-livepanel-empty hidden />;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {data.map((p) => (
        <section key={p.name}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, alignSelf: "center",
              background: stream.connected ? "#22c55e" : "#94a3b8" }} title={stream.connected ? "live" : "reconnecting"} />
            <strong style={{ fontWeight: 600 }}>{p.title || (p.name === "main" ? "Live panel" : p.name)}</strong>
            <span>{new Date(p.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
          </div>
          <Frame panel={p} submit={submitFor(p.name)} />
        </section>
      ))}
    </div>
  );
}

export function LivePanels({ context }: PluginDetailTabProps) {
  const [attempt, setAttempt] = useState(0);
  const onLost = useCallback(() => { setTimeout(() => setAttempt((a) => a + 1), 3000); }, []);
  if (!context.companyId) return null;
  return (
    <>
      <style>{"div:has(> [data-livepanel-empty]){display:none}"}</style>
      <Panels key={attempt} companyId={context.companyId} issueId={context.entityId} onLost={onLost} />
    </>
  );
}
