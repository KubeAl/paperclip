// The document inside the sandboxed iframe. Agent HTML never touches the host DOM:
// it arrives by postMessage and this runtime morphs it into the frame's body.
const CSP = [
  "default-src 'none'", "script-src 'unsafe-inline'", "style-src 'unsafe-inline'", "img-src data: blob:",
  "font-src data:", "media-src data: blob:", "connect-src 'none'", "form-action 'none'", "base-uri 'none'",
  "frame-src 'none'", "object-src 'none'",
].join("; ");

const CSS = `
:root{--fg:#111827;--muted:#6b7280;--bd:rgba(127,127,127,.28);--bg2:rgba(127,127,127,.07);--acc:#2563eb;--ok:#16a34a;--warn:#d97706;--err:#dc2626;--info:#2563eb;color-scheme:light}
:root[data-theme=dark]{--fg:#e5e7eb;--muted:#9ca3af;--acc:#3b82f6;--ok:#22c55e;--warn:#f59e0b;--err:#ef4444;--info:#60a5fa;color-scheme:dark}
*{box-sizing:border-box}
body{margin:0;padding:1px;font:14px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--fg);background:transparent;font-variant-numeric:tabular-nums}
h1,h2,h3{margin:.6em 0 .35em;line-height:1.25}h1{font-size:1.2em}h2{font-size:1.05em}h3{font-size:.8em;text-transform:uppercase;letter-spacing:.04em;color:var(--muted)}
p{margin:.4em 0}.muted,small{color:var(--muted);font-size:.88em}a{color:var(--acc)}
table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid var(--bd);padding:6px 8px;text-align:left;vertical-align:top}
th{font-weight:600;color:var(--muted);font-size:.85em}.num,td.num,th.num{text-align:right;white-space:nowrap}
input,select,textarea,button{font:inherit;color:inherit;border:1px solid var(--bd);border-radius:6px;padding:5px 9px;background:transparent}
input[type=checkbox],input[type=radio]{width:16px;height:16px;margin:0;accent-color:var(--ok);flex:none;cursor:pointer}
textarea{width:100%;min-height:4em}
button{cursor:pointer;background:var(--bg2)}button.primary,button[type=submit]{background:var(--acc);border-color:var(--acc);color:#fff}
button:disabled,input:disabled,select:disabled,textarea:disabled{opacity:.55;cursor:default}
label{display:block;margin:.45em 0}label>input:not([type=checkbox]):not([type=radio]),label>select,label>textarea{display:block;margin-top:2px}
form{margin:.5em 0}fieldset{border:1px solid var(--bd);border-radius:8px}
.card{border:1px solid var(--bd);border-radius:10px;padding:10px 12px;margin:.6em 0}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.spacer{flex:1}
.ok{color:var(--ok)}.warn{color:var(--warn)}.err{color:var(--err)}.info{color:var(--info)}
.badge,.pill{display:inline-flex;align-items:center;gap:4px;padding:1px 8px;border-radius:999px;font-size:.78em;font-weight:600;white-space:nowrap;color:var(--muted);background:var(--bg2)}
.pill.ok{color:var(--ok);background:color-mix(in srgb,var(--ok) 14%,transparent)}
.pill.warn{color:var(--warn);background:color-mix(in srgb,var(--warn) 16%,transparent)}
.pill.err{color:var(--err);background:color-mix(in srgb,var(--err) 14%,transparent)}
.pill.info{color:var(--info);background:color-mix(in srgb,var(--info) 14%,transparent)}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:8px;margin:.6em 0}
.tile{border:1px solid var(--bd);border-left:3px solid var(--bd);border-radius:8px;padding:8px 10px}
.tile .v{font-size:1.45em;font-weight:650;line-height:1.2}.tile .l{font-size:.8em;color:var(--muted)}
.tile.ok{border-left-color:var(--ok)}.tile.warn{border-left-color:var(--warn)}.tile.err{border-left-color:var(--err)}.tile.info{border-left-color:var(--info)}
.tile.ok .v{color:var(--ok)}.tile.warn .v{color:var(--warn)}.tile.err .v{color:var(--err)}
.list{border:1px solid var(--bd);border-radius:10px;margin:.6em 0;overflow:hidden}
.item{display:flex;gap:10px;align-items:flex-start;padding:9px 12px;margin:0;border-top:1px solid var(--bd)}.item:first-child{border-top:0}
label.item{cursor:pointer}label.item:hover{background:var(--bg2)}.item>input{margin-top:2px}
.item .main{flex:1;min-width:0}.item .t{font-weight:550}.item .sub{color:var(--muted);font-size:.86em;margin-top:1px}
.item:has(>input[type=checkbox]:checked) .t{text-decoration:line-through;color:var(--muted)}.item:has(>input[type=checkbox]:checked) .pill{opacity:.45}
.kv{display:grid;grid-template-columns:max-content 1fr;gap:3px 14px;margin:.4em 0}.kv>:nth-child(odd){color:var(--muted)}
details{border:1px solid var(--bd);border-radius:8px;padding:6px 10px;margin:.5em 0}summary{cursor:pointer;font-weight:550}details[open]>summary{margin-bottom:6px}
progress{width:100%;height:8px;accent-color:var(--acc)}
pre,code{font:12px/1.45 ui-monospace,Menlo,monospace}pre{background:var(--bg2);padding:8px;border-radius:6px;overflow:auto;max-height:320px}
.pc-status{font-size:.85em;color:var(--muted);margin:.3em 0}
`;

function runtime() {
  const send = (m: unknown) => parent.postMessage(m, "*");
  let data: Record<string, unknown> = {};
  const dataCbs: Array<(d: Record<string, unknown>) => void> = [];
  const pending = new Map<number, { res: () => void; rej: (e: Error) => void }>();
  let n = 0;
  (window as any).paperclip = {
    get data() { return data; },
    onData(cb: (d: Record<string, unknown>) => void) { dataCbs.push(cb); try { cb(data); } catch (e) { console.error(e); } },
    submit(values?: unknown, opts: { action?: string; wake?: boolean } = {}) {
      const id = ++n;
      send({ t: "submit", id, action: opts.action || "submit", values: values ?? {}, wake: opts.wake !== false });
      return new Promise<void>((res, rej) => pending.set(id, { res, rej }));
    },
  };

  const same = (a: Node, b: Node) => {
    if (a.nodeType !== b.nodeType) return false;
    if (a.nodeType !== 1) return true;
    const x = a as Element, y = b as Element;
    if (x.tagName !== y.tagName || x.id !== y.id) return false;
    return x.tagName !== "SCRIPT" || x.textContent === y.textContent;
  };
  function morph(f: Node, t: Node) {
    if (f.nodeType !== 1) { if (f.nodeValue !== t.nodeValue) f.nodeValue = t.nodeValue; return; }
    const fe = f as Element, te = t as Element;
    for (const a of [...fe.attributes]) if (!a.name.startsWith("data-pc-") && !te.hasAttribute(a.name)) fe.removeAttribute(a.name);
    for (const a of [...te.attributes]) if (fe.getAttribute(a.name) !== a.value) fe.setAttribute(a.name, a.value);
    if (fe.tagName === "SCRIPT") return;
    const kids = [...t.childNodes];
    kids.forEach((tc, i) => {
      const fc = f.childNodes[i];
      if (!fc) f.appendChild(document.importNode(tc, true));
      else if (same(fc, tc)) morph(fc, tc);
      else f.replaceChild(document.importNode(tc, true), fc);
    });
    while (f.childNodes.length > kids.length) f.removeChild(f.lastChild!);
  }
  function runScripts() {
    for (const old of document.body.querySelectorAll("script:not([data-pc-ran])")) {
      const s = document.createElement("script");
      for (const a of [...old.attributes]) s.setAttribute(a.name, a.value);
      s.textContent = old.textContent; s.setAttribute("data-pc-ran", "");
      old.replaceWith(s);
    }
  }
  function bind() {
    for (const el of document.querySelectorAll<HTMLElement>("[data-bind]")) {
      const v = el.dataset.bind!.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), data);
      if (v === undefined) continue;
      if (el instanceof HTMLProgressElement || el instanceof HTMLMeterElement) el.value = Number(v);
      else if (el instanceof HTMLInputElement && document.activeElement !== el) el.value = String(v);
      else if (!(el instanceof HTMLInputElement)) el.textContent = String(v);
    }
  }
  const fragment = (html: string) => { const t = document.createElement("template"); t.innerHTML = html; return t.content; };
  function render(html: string, saved?: Record<string, unknown>) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    doc.body.prepend(...doc.head.querySelectorAll("style,script"));
    morph(document.body, doc.body);
    restore(saved); runScripts(); bind();
  }
  function patch(ops: Array<{ target?: string; mode?: string; html?: string }>) {
    for (const o of ops) {
      let els: Element[];
      try { els = o.target ? [...document.querySelectorAll(o.target)] : [document.body]; }
      catch { console.warn("live panel: bad selector", o.target); continue; }
      for (const el of els) {
        const html = o.html ?? "", mode = o.mode || "inner";
        if (mode === "remove") el.remove();
        else if (mode === "text") el.textContent = html;
        else if (mode === "append") el.append(fragment(html));
        else if (mode === "prepend") el.prepend(fragment(html));
        else if (mode === "outer") el.replaceWith(fragment(html));
        else { const t = el.cloneNode(false) as Element; t.append(fragment(html)); morph(el, t); }
      }
    }
    runScripts(); bind();
  }
  function status(form: HTMLFormElement, text: string) {
    let s = form.nextElementSibling;
    if (!s?.classList.contains("pc-status")) { s = document.createElement("p"); s.className = "pc-status"; form.after(s); }
    s.textContent = text;
  }
  const formAction = (form: HTMLFormElement, sub?: HTMLElement | null) =>
    sub?.dataset.action || form.dataset.action || form.getAttribute("name") || "submit";
  function formValues(form: HTMLFormElement, sub?: HTMLElement | null) {
    const values: Record<string, unknown> = {};
    for (const [k, x] of new FormData(form, sub)) {
      const v = typeof x === "string" ? x : x.name;
      values[k] = k in values ? ([] as unknown[]).concat(values[k], v) : v;
    }
    return values;
  }
  // Put the user's saved answers (sent since the agent's last render) back into the forms.
  function restore(saved: Record<string, any> | undefined) {
    for (const form of document.forms) {
      const v = saved?.[formAction(form)];
      if (!v) continue;
      for (const el of form.elements as unknown as HTMLInputElement[]) {
        if (!el.name || el === document.activeElement) continue;
        const cur = v[el.name], list = ([] as unknown[]).concat(cur ?? []).map(String);
        if (el.type === "checkbox" || el.type === "radio") el.checked = list.includes(el.value);
        else if (cur !== undefined && el.type !== "submit" && el.type !== "button") el.value = String(list[0]);
      }
    }
  }
  document.addEventListener("submit", (e) => {
    e.preventDefault();
    const form = e.target as HTMLFormElement, sub = (e as SubmitEvent).submitter as HTMLElement | null;
    const action = formAction(form, sub), values = formValues(form, sub);
    const wake = (sub?.dataset.wake ?? form.dataset.wake) !== "false";
    const fields = [...form.elements] as HTMLInputElement[];
    fields.forEach((f) => (f.disabled = true)); status(form, "Sending…");
    (window as any).paperclip.submit(values, { action, wake }).then(
      () => { fields.forEach((f) => (f.disabled = false)); status(form, "Sent to the agent."); },
      (err: Error) => { fields.forEach((f) => (f.disabled = false)); status(form, "Not sent: " + err.message); },
    );
  }, true);
  // <form data-save>: every change is stored at once without waking the agent (checklists, notes).
  const saveTimers = new WeakMap<HTMLFormElement, number>();
  const autosave = (e: Event) => {
    const form = (e.target as HTMLInputElement).form;
    if (!form || !form.hasAttribute("data-save")) return;
    clearTimeout(saveTimers.get(form));
    saveTimers.set(form, setTimeout(() => {
      (window as any).paperclip.submit(formValues(form), { action: formAction(form), wake: false })
        .then(() => status(form, "Saved."), (err: Error) => status(form, "Not saved: " + err.message));
    }, e.type === "change" ? 150 : 800) as unknown as number);
  };
  document.addEventListener("change", autosave);
  document.addEventListener("input", autosave);
  document.addEventListener("click", (e) => {
    const t = e.target as Element;
    const b = t.closest<HTMLElement>("[data-submit]");
    if (b && !b.closest("form")) {
      e.preventDefault();
      let values = {};
      try { values = JSON.parse(b.dataset.values || "{}"); } catch { /* plain button */ }
      (window as any).paperclip.submit(values, { action: b.dataset.submit, wake: b.dataset.wake !== "false" })
        .then(() => b.setAttribute("data-pc-sent", ""), (err: Error) => console.warn(err));
      return;
    }
    const a = t.closest("a[href]") as HTMLAnchorElement | null;
    if (a && !a.getAttribute("href")!.startsWith("#")) { e.preventDefault(); send({ t: "open", url: a.href }); }
  }, true);
  addEventListener("message", (e) => {
    if (e.source !== parent) return;
    const m = e.data || {};
    if (m.t === "render") { document.documentElement.dataset.theme = m.theme; render(m.html, m.saved); }
    else if (m.t === "patch") patch(m.ops);
    else if (m.t === "data") { data = m.data || {}; bind(); dataCbs.forEach((cb) => { try { cb(data); } catch (err) { console.error(err); } }); }
    else if (m.t === "ack") {
      const p = pending.get(m.id); if (!p) return; pending.delete(m.id);
      m.ok ? p.res() : p.rej(new Error(m.error || "failed"));
    }
  });
  addEventListener("DOMContentLoaded", () => {
    new ResizeObserver(() => send({ t: "height", h: document.documentElement.scrollHeight })).observe(document.body);
    send({ t: "ready" });
  });
}

export const SRCDOC = `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${CSP}">
<style>${CSS}</style><script>(${runtime.toString()})()</script></head><body></body></html>`;
