// Loads ONLYOFFICE's api.js from the Docs server and opens a DocEditor in `el` (replaced by the editor iframe).
type EditorConfig = { status: string; docs_url: string; config: Record<string, unknown> };
type DocEditor = { destroyEditor(): void };
declare global { interface Window { DocsAPI?: { DocEditor: new (id: string, config: Record<string, unknown>) => DocEditor } } }

let api: Promise<void> | undefined;
function loadApi(docsUrl: string) {
  api ??= new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${docsUrl.replace(/\/$/, "")}/web-apps/apps/api/documents/api.js`;
    s.onload = () => resolve();
    s.onerror = () => { api = undefined; reject(new Error(`Could not load the editor from ${docsUrl}`)); };
    document.head.appendChild(s);
  });
  return api;
}

let seq = 0;
export async function mountEditor(el: HTMLElement, res: EditorConfig): Promise<DocEditor> {
  if (res.status !== "OK") throw new Error(`Odoo says ${res.status}`);
  await loadApi(res.docs_url);
  const holder = document.createElement("div");
  holder.id = `odoodocs-editor-${++seq}`;
  el.replaceChildren(holder);
  // width/height are read by api.js only; they are not part of the signed document config.
  return new window.DocsAPI!.DocEditor(holder.id, { ...res.config, width: "100%", height: "100%" });
}

// The plugin's uuid: the static route /_plugins/<id>/ui/... fails when addressed by key.
export const pluginId = () => fetch("/api/plugins", { credentials: "include" }).then((r) => r.json())
  .then((list: Array<{ id: string; pluginKey: string }>) => list.find((p) => p.pluginKey === "shellkube.odoodocs")!.id);
