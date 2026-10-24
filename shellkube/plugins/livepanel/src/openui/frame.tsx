// OpenUI panel in a sandboxed frame. The host sends {t:"load", ui, theme}; user actions go back as {t:"submit"} and
// {t:"open"}, the page height as {t:"height"}. React and the OpenUI library live only in this frame.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { Renderer, type ActionEvent } from "@openuidev/react-lang";
import { ThemeProvider } from "@openuidev/react-ui";
import "@openuidev/react-ui/components.css";
import { lib } from "./lib";

const post = (m: unknown) => parent.postMessage(m, "*");

// formState is {form: {field: {value, componentType}}, $var: value}; the agent gets {field: value, var: value}.
function values(e: ActionEvent): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(e.formState ?? {})) {
    if (k.startsWith("$")) out[k.slice(1)] = v;
    else if (v && typeof v === "object") for (const [f, x] of Object.entries(v)) out[f] = (x as { value?: unknown })?.value ?? x;
  }
  const ctx = e.params.context;
  return ctx && typeof ctx === "object" && !Array.isArray(ctx) ? { ...out, ...ctx } : ctx === undefined ? out : { ...out, context: ctx };
}

function onAction(e: ActionEvent) {
  if (e.type === "continue_conversation") post({ t: "submit", action: e.humanFriendlyMessage || "submit", values: values(e) });
  else if (e.type === "open_url") post({ t: "open", url: e.params.url });
}

let show: (m: { ui: string; theme: "light" | "dark" }) => void = () => {};
function App() {
  const [m, setM] = useState<{ ui: string; theme: "light" | "dark" } | null>(null);
  show = setM;
  if (!m) return null;
  document.documentElement.style.colorScheme = m.theme;
  return <ThemeProvider mode={m.theme}><Renderer response={m.ui} library={lib} onAction={onAction} /></ThemeProvider>;
}

const root = document.getElementById("root")!;
createRoot(root).render(<App />);
// Measure #root, not body: Radix popovers restyle body when they open, and a frame resize closes them again.
new ResizeObserver(() => post({ t: "height", h: root.offsetHeight + 2 })).observe(root);
window.addEventListener("message", (e) => {
  if (e.source === parent && e.data?.t === "load") show({ ui: String(e.data.ui), theme: e.data.theme === "dark" ? "dark" : "light" });
});
post({ t: "ready" });
