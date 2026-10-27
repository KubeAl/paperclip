// "Open in new tab": /_plugins/<uuid>/ui/editor/index.html?company=<id>&file=<id>
import { mountEditor } from "../ui/docs";

const q = new URLSearchParams(location.search), plugin = location.pathname.split("/")[2];
const el = document.getElementById("editor")!;
(async () => {
  const r = await fetch(`/api/plugins/${plugin}/actions/editor-config`, {
    method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ companyId: q.get("company"), params: { fileId: Number(q.get("file")) } }),
  });
  const body = await r.json();
  if (!r.ok) throw new Error(body.message ?? body.error ?? `HTTP ${r.status}`);
  await mountEditor(el, body.data);
})().catch((e) => { el.textContent = e instanceof Error ? e.message : String(e); });
