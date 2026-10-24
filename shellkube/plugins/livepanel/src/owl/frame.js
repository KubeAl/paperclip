// o-spreadsheet (Odoo's OWL spreadsheet) in a sandboxed frame. The host sends {t:"load", data}: agent sheet JSON,
// an unzipped .xlsx ({path: xml}) or a saved o-spreadsheet export. {t:"collect"} answers with the same shape as the
// HyperFormula sheet panel ({changes, sheets, values}) plus the full export (owl) for restore.
const { App, Component, xml } = owl;
const { Spreadsheet, Model, helpers, stores } = o_spreadsheet;
const post = (m) => parent.postMessage(m, "*");
const num = (v) => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
let app, model, initial;

class Root extends Component {
  static template = xml`<div style="height:100vh"><Spreadsheet model="props.model" notifyUser.bind="notify"/></div>`;
  static components = { Spreadsheet };
  static props = ["model"];
  setup() { stores.useStoreProvider(); }
  notify(n) { post({ t: "error", error: n.text }); }
}

function fromAgent(sheets) {
  return { sheets: Object.entries(sheets).map(([name, rows], i) => {
    const cells = {};
    rows.forEach((row, r) => row.forEach((v, c) => {
      if (v !== null && v !== "") cells[helpers.toXC(c, r)] = v === true ? "TRUE" : v === false ? "FALSE" : String(v);
    }));
    return { id: `sheet${i}`, name, cells };
  }) };
}

// {sheet name: [[...]]} of each cell's content (formulas) or evaluated value.
function grid(pick) {
  const g = model.getters, out = {};
  for (const sheetId of g.getSheetIds()) {
    const rows = [];
    for (const id of Object.keys(g.getCells(sheetId))) {
      const { col, row } = g.getCellPosition(id), p = { sheetId, col, row };
      const v = pick(p, g);
      if (v === "" || v === null || v === undefined) continue;
      rows[row] ??= [];
      rows[row][col] = v;
    }
    out[g.getSheetName(sheetId)] = Array.from(rows, (r) => Array.from(r ?? [], (v) => v ?? null));
  }
  return out;
}
const contents = () => grid((p, g) => num(g.getCell(p)?.content ?? ""));
const values = () => grid((p, g) => g.getEvaluatedCell(p).value);

async function load(data) {
  if (app) app.destroy();
  const osp = data["[Content_Types].xml"] || Array.isArray(data.sheets);
  model = new Model(osp ? data : fromAgent(data), { mode: "normal" });
  initial = contents();
  app = new App(Root, { props: { model }, templates: OSP_TEMPLATES });
  await app.mount(document.body);
}

function changes() {
  const now = contents(), out = [], g = model.getters;
  for (const [name, rows] of Object.entries(now)) {
    const before = initial[name] ?? [], sheetId = g.getSheetIdByName(name);
    const height = Math.max(rows.length, before.length);
    for (let r = 0; r < height; r++) {
      const width = Math.max(rows[r]?.length ?? 0, before[r]?.length ?? 0);
      for (let c = 0; c < width; c++) {
        const from = before[r]?.[c] ?? null, to = rows[r]?.[c] ?? null;
        if (from !== to) out.push({ cell: `${/^[A-Za-z0-9_]+$/.test(name) ? name : `'${name.replace(/'/g, "''")}'`}!${helpers.toXC(c, r)}`, from, to,
          value: g.getEvaluatedCell({ sheetId, col: c, row: r }).value ?? null });
      }
    }
  }
  return out;
}

window.addEventListener("message", (e) => {
  if (e.source !== parent) return;
  const m = e.data ?? {};
  try {
    if (m.t === "load") load(m.data).catch((err) => post({ t: "error", error: String(err?.message ?? err) }));
    else if (m.t === "collect") post({ t: "state", values: { changes: changes(), sheets: contents(), values: values() }, owl: model.exportData() });
    else if (m.t === "saved") initial = contents();
  } catch (err) { post({ t: "error", error: String(err?.message ?? err) }); }
});
post({ t: "ready" });
