import { useCallback, useEffect, useRef, useState } from "react";
import { usePluginAction, usePluginData, usePluginStream, type PluginDetailTabProps } from "@paperclipai/plugin-sdk/ui";
import { SRCDOC } from "./frame";
import { defineRegistry, JSONUIProvider, Renderer, useBoundProp, useFieldValidation, useValidation } from "@json-render/react";
import { shadcnComponents } from "@json-render/shadcn";
import type { Spec } from "@json-render/core";
import { catalog, NAMES } from "../catalog";
import type { Sheets } from "../sheet";
import { SheetPanel } from "./sheet";
import { OwlSheet } from "./owl";
import { OpenUIPanel } from "./openui";

// submit is handled per panel by JSONUIProvider handlers, so the registry only carries components.
const { registry } = defineRegistry(catalog, {
  components: { ...Object.fromEntries(NAMES.map((n) => [n, shadcnComponents[n]])), DateInput },
} as Parameters<typeof defineRegistry<typeof catalog>>[1]);

// Same look as the shadcn Input, with the browser's date picker.
function DateInput({ props, bindings }: { props: Record<string, any>; bindings?: Record<string, string> }) {
  const [value, setValue] = useBoundProp<string>(props.value ?? undefined, bindings?.value);
  const { errors, validate } = useFieldValidation(bindings?.value ?? "", props.checks?.length ? { checks: props.checks, validateOn: "change" } : undefined);
  return (
    <div className="space-y-2">
      <label htmlFor={props.name} className="flex items-center gap-2 text-sm leading-none font-medium">{props.label}</label>
      <input id={props.name} name={props.name} type="date" min={props.min ?? undefined} max={props.max ?? undefined} value={value ?? ""}
        onChange={(e) => { setValue(e.target.value); validate(); }}
        className="border-input h-9 w-full max-w-60 rounded-md border bg-transparent px-3 py-1 text-base shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] dark:bg-input/30 md:text-sm" />
      {errors.length > 0 && <p className="text-sm text-destructive">{errors[0]}</p>}
    </div>
  );
}

type Op = { target?: string; mode?: string; html?: string };
type PanelState = {
  name: string; title: string; html: string; spec?: Spec; sheet?: Sheets; openui?: string; engine?: "owl"; xlsx?: Record<string, string>; patches: Op[]; data: Record<string, unknown>;
  version: number; rev: number; updatedAt: string; saved: Record<string, unknown>;
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
      w.postMessage({ t: "render", html: p.html, theme: isDark() ? "dark" : "light", saved: p.saved }, "*");
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

// Agent spec rendered with native components: no frame needed, the spec is data, not code.
// Hands the provider's validateAll to the submit handler, so required fields block a submit.
function ValidationBridge({ into }: { into: { current: () => boolean } }) {
  const v = useValidation();
  into.current = v.validateAll;
  return null;
}

function SpecPanel({ panel, submit }: {
  panel: PanelState;
  submit: (m: { action: string; values: unknown; wake: boolean }) => Promise<unknown>;
}) {
  const [sent, setSent] = useState("");
  const validateAll = useRef<() => boolean>(() => true);
  const handlers = {
    submit: async (params: Record<string, unknown>) => {
      const action = String(params.action ?? "submit");
      if (action !== "cancel" && !validateAll.current()) { setSent("Fix the marked fields first."); return; }
      setSent("Sending…");
      try {
        await submit({ action, values: params.values ?? {}, wake: params.wake !== false });
        setSent(`Sent: ${action}`);
      } catch (err) {
        setSent(`Not sent: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
  return (
    <div>
      <JSONUIProvider registry={registry} initialState={panel.spec!.state ?? {}} handlers={handlers}>
        <Renderer spec={panel.spec!} registry={registry} />
        <ValidationBridge into={validateAll} />
      </JSONUIProvider>
      {sent && <p style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{sent}</p>}
    </div>
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
  // Pinned panels stay first, in pin order, so saves and agent updates do not move them (moving a frame also reloads it).
  const pinKey = `livepanel-pins:${issueId}`;
  const [pins, setPins] = useState<string[]>(() => JSON.parse(localStorage.getItem(pinKey) ?? "[]"));
  const togglePin = (name: string) => {
    const next = pins.includes(name) ? pins.filter((n) => n !== name) : [...pins, name];
    localStorage.setItem(pinKey, JSON.stringify(next));
    setPins(next);
  };

  const submitFor = useCallback((panel: string) =>
    (m: { action: string; values: unknown; wake: boolean }) => action({ companyId, issueId, panel, ...m }), [action, companyId, issueId]);

  // Ask the host to open the side panel tab once per rendered panel version.
  useEffect(() => {
    for (const p of data ?? []) {
      const seen = `livepanel-seen:${issueId}:${p.name}:${p.version}`;
      if (sessionStorage.getItem(seen)) continue;
      sessionStorage.setItem(seen, "1");
      window.dispatchEvent(new CustomEvent("paperclip:open-plugin-tab", { detail: { issueId, slot: "shellkube.livepanel:panels" } }));
    }
  }, [data, issueId]);

  const watch = <Watch key={attempt} companyId={companyId} issueId={issueId} onEvent={refresh} onLive={setLive} onLost={onLost} />;
  if (!data?.length) return <>{watch}<p style={{ fontSize: 13, opacity: 0.7, margin: 0 }}>No live panel on this task yet.</p></>;
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {watch}
      {[
        ...pins.flatMap((n) => data.filter((p) => p.name === n)),
        ...data.filter((p) => !pins.includes(p.name)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
      ].map((p) => (
        <section key={p.name}>
          <div style={{ display: "flex", gap: 8, alignItems: "baseline", fontSize: 12, opacity: 0.7, marginBottom: 4 }}>
            <span style={{ width: 7, height: 7, borderRadius: 4, alignSelf: "center",
              background: live ? "#22c55e" : "#94a3b8" }} title={live ? "live" : "reconnecting"} />
            <strong style={{ fontWeight: 600 }}>{p.title || (p.name === "main" ? "Live panel" : p.name)}</strong>
            <span>{new Date(p.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            <button onClick={() => togglePin(p.name)} title={pins.includes(p.name) ? "Unpin" : "Pin to top"} aria-pressed={pins.includes(p.name)}
              style={{ marginLeft: "auto", fontSize: 12, padding: "1px 8px", borderRadius: 6, border: "1px solid var(--border)", cursor: "pointer",
                background: pins.includes(p.name) ? "var(--accent)" : "transparent", fontWeight: pins.includes(p.name) ? 600 : 400 }}>
              {pins.includes(p.name) ? "Pinned" : "Pin"}
            </button>
          </div>
          {p.sheet && p.engine === "owl"
            ? <OwlSheet key={p.version} name={p.title || p.name} data={(p.saved.sheet as { owl?: unknown } | undefined)?.owl ?? p.xlsx ?? p.sheet} submit={submitFor(p.name)} />
            : p.sheet
            ? <SheetPanel key={p.version} sheets={(p.saved.sheet as { sheets?: Sheets } | undefined)?.sheets ?? p.sheet} submit={submitFor(p.name)} />
            : p.openui
            ? <OpenUIPanel key={p.version} ui={p.openui} submit={submitFor(p.name)} />
            : p.spec
            ? <SpecPanel key={p.version} panel={p} submit={submitFor(p.name)} />
            : <Frame panel={p} submit={submitFor(p.name)} />}
        </section>
      ))}
    </div>
  );
}

export function LivePanels({ context }: PluginDetailTabProps) {
  if (!context.companyId) return null;
  return <Panels companyId={context.companyId} issueId={context.entityId} />;
}
