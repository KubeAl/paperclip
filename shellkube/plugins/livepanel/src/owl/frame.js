// o-spreadsheet (Odoo's OWL spreadsheet) in a sandboxed frame. The host sends {t:"load", data}: agent sheet JSON,
// an unzipped .xlsx ({path: xml}) or a saved o-spreadsheet export. {t:"collect"} answers with the same shape as the
// HyperFormula sheet panel ({changes, sheets, values}) plus the full export (owl) for restore.
const { App, Component, xml } = owl;
const { Spreadsheet, Model, helpers, stores, registries } = o_spreadsheet;
const post = (m) => parent.postMessage(m, "*");
const num = (v) => typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : v;
let app, model, initial, fileName = "sheet";

// o-spreadsheet scrolls sheet tabs into view without a `block` option (default "start"), which also scrolls the host's
// side panel and hides the top menu. "nearest" only scrolls when the element is out of view.
const scrollIntoView = Element.prototype.scrollIntoView;
Element.prototype.scrollIntoView = function (o) {
  scrollIntoView.call(this, { block: "nearest", inline: "nearest", ...(typeof o === "object" ? o : {}) });
};

const crcTable = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = (bytes) => {
  let c = -1;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
};

// Store-only zip of exportXLSX() parts: what Odoo's /spreadsheet/xlsx route does on the server.
// shortcut: image parts ({path, imageSrc}) are skipped; agent panels have no images.
function xlsxBlob(files) {
  const enc = new TextEncoder(), body = [], dir = [];
  let offset = 0;
  for (const f of files.filter((f) => typeof f.content === "string")) {
    // o-spreadsheet writes errorStyle="" for blocking validation rules; Excel's default ("stop") is the same rule.
    const name = enc.encode(f.path), data = enc.encode(f.content.replaceAll(' errorStyle=""', "")), crc = crc32(data);
    const local = new DataView(new ArrayBuffer(30)), central = new DataView(new ArrayBuffer(46));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    central.setUint32(0, 0x02014b50, true); central.setUint16(4, 20, true); central.setUint16(6, 20, true);
    central.setUint16(14, 0x21, true); central.setUint32(16, crc, true); central.setUint32(20, data.length, true);
    central.setUint32(24, data.length, true); central.setUint16(28, name.length, true); central.setUint32(42, offset, true);
    body.push(local, name, data);
    dir.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, dir.length / 2, true); end.setUint16(10, dir.length / 2, true);
  end.setUint32(12, dir.reduce((n, p) => n + p.byteLength, 0), true); end.setUint32(16, offset, true);
  return new Blob([...body, ...dir, end], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

registries.topbarMenuRegistry.addChild("download_xlsx", ["file"], {
  name: "Download (.xlsx)",
  sequence: 5,
  isReadonlyAllowed: true,
  icon: "o-spreadsheet-Icon.DOWNLOAD",
  execute: () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(xlsxBlob(model.exportXLSX().files));
    a.download = `${fileName}.xlsx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  },
});

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
    if (m.t === "load") { fileName = String(m.name || "sheet").replace(/[\\/:*?"<>|]+/g, " ").trim() || "sheet"; load(m.data).catch((err) => post({ t: "error", error: String(err?.message ?? err) })); }
    else if (m.t === "collect") post({ t: "state", values: { changes: changes(), sheets: contents(), values: values() }, owl: model.exportData() });
    else if (m.t === "saved") initial = contents();
  } catch (err) { post({ t: "error", error: String(err?.message ?? err) }); }
});
post({ t: "ready" });
