import { useEffect, useRef, useState } from "react";
import { frameUrl } from "./owl";

type Submit = (m: { action: string; values: unknown; wake: boolean }) => Promise<unknown>;

// OpenUI Lang rendered by @openuidev/react-ui in an opaque-origin frame (dist/ui/openui): its React, Radix portals
// and CSS stay out of the host page, and the frame CSP blocks all network.
export function OpenUIPanel({ ui, submit }: { ui: string; submit: Submit }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [url, setUrl] = useState("");
  const [height, setHeight] = useState(80);
  const [msg, setMsg] = useState("");
  useEffect(() => { frameUrl("openui").then(setUrl, (e) => setMsg(`Cannot load OpenUI: ${e}`)); }, []);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      const w = ref.current?.contentWindow;
      if (!w || e.source !== w) return;
      const m = e.data ?? {};
      if (m.t === "ready") w.postMessage({ t: "load", ui, theme: document.documentElement.classList.contains("dark") ? "dark" : "light" }, "*");
      else if (m.t === "height") setHeight(Math.min(1200, Math.max(24, Number(m.h) || 0)));
      else if (m.t === "open" && /^https?:\/\//i.test(String(m.url))) window.open(String(m.url), "_blank", "noopener,noreferrer");
      else if (m.t === "submit") {
        const action = String(m.action);
        setMsg("Sending…");
        submit({ action, values: m.values ?? {}, wake: true })
          .then(() => setMsg(`Sent: ${action}`), (err) => setMsg(`Not sent: ${err instanceof Error ? err.message : String(err)}`));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [ui, submit]);

  return (
    <div>
      <iframe ref={ref} title="OpenUI panel" src={url || undefined} sandbox="allow-scripts" referrerPolicy="no-referrer"
        style={{ display: "block", width: "100%", height, border: 0 }} />
      {msg && <p style={{ fontSize: 12, opacity: 0.7, marginTop: 6 }}>{msg}</p>}
    </div>
  );
}
