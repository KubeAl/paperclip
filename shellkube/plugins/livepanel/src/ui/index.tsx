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

  // allow-forms only lets the submit event fire; the frame CSP (form-action 'none') blocks any real submission.
  return (
    <iframe ref={ref} title={panel.title || panel.name} srcDoc={SRCDOC} sandbox="allow-scripts allow-forms" referrerPolicy="no-referrer"
      style={{ display: "block", width: "100%", height, border: 0, colorScheme: isDark() ? "dark" : "light" }} />
  );
}

// usePluginStream never reconnects by itself (error, server restart, plugin reload), so this part is
// remounted after a pause. Kept apart from the frames so a reconnect does not reload them.
function Watch({ companyId, issueId, onEvent, onLive, onLost }: {
  companyId: string; issueId: string; onEvent: () => void; onLive: (live: boolean) => void; onLost: () => void;
}) {
  const stream = usePluginStream<{ panel: string }>(`issue:${issueId}`, { companyId });
  useEffect(() => { if (stream.events.length) onEvent(); }, [stream.events.length]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    onLive(stream.connected);
    if (stream.connected) onEvent();
    else if (!stream.connecting) onLost();
  }, [stream.connected, stream.connecting]); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function Panels({ companyId, issueId }: { companyId: string; issueId: string }) {
  const { data, refresh } = usePluginData<PanelState[]>("panels", { companyId, issueId });
  const action = usePluginAction("submit");
  const [attempt, setAttempt] = useState(0);
  const [live, setLive] = useState(false);
  const onLost = useCallback(() => { setTimeout(() => setAttempt((a) => a + 1), 3000); }, []);

  const submitFor = useCallback((panel: string) =>
    (m: { action: string; values: unknown; wake: boolean }) => action({ companyId, issueId, panel, ...m }), [action, companyId, issueId]);

  const watch = <Watch key={attempt} companyId={companyId} issueId={issueId} onEvent={refresh} onLive={setLive} onLost={onLost} />;
  if (!data?.length) return <>{watch}<span data-livepanel-empty hidden /></>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {watch}
      {data.map((p) => (
        <section key={p.name}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, alignSelf: "center",
              background: live ? "#22c55e" : "#94a3b8" }} title={live ? "live" : "reconnecting"} />
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
  if (!context.companyId) return null;
  return (
    <>
      <style>{"div:has(> [data-livepanel-empty]){display:none}"}</style>
      <Panels companyId={context.companyId} issueId={context.entityId} />
    </>
  );
}
