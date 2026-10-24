import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { DetailedCellError, type SimpleCellAddress } from "hyperformula";
import { a1, buildSheets, colName, plain, type Sheets } from "../sheet";

type Submit = (m: { action: string; values: unknown; wake: boolean }) => Promise<unknown>;
type Change = { cell: string; from: unknown; to: unknown; addr: SimpleCellAddress };

const show = (v: unknown) => v instanceof DetailedCellError ? v.value
  : typeof v === "number" ? v.toLocaleString(undefined, { maximumFractionDigits: 4 }) : v == null ? "" : String(v);
const line = "1px solid var(--border)";
const head = { background: "var(--muted)", color: "var(--muted-foreground)", fontWeight: 500, padding: "2px 6px", border: line, position: "sticky" } as const;
const button = { fontSize: 12, padding: "3px 10px", borderRadius: 6, border: line, background: "transparent", cursor: "pointer" } as const;

// Agent sheet computed live in the browser: the user edits cells, dependents recalc at once, Save/Send hands it back.
export function SheetPanel({ sheets, submit }: { sheets: Sheets; submit: Submit }) {
  const [hf] = useState(() => buildSheets(sheets)); // the parent remounts on a new render version
  useEffect(() => () => hf.destroy(), [hf]);
  const names = hf.getSheetNames();
  const [tab, setTab] = useState(0);
  const [sel, setSel] = useState<{ row: number; col: number } | null>(null);
  const [draft, setDraft] = useState("");
  const [msg, setMsg] = useState("");
  const [, rerender] = useState(0);
  const changes = useRef(new Map<string, Change>());
  const input = useRef<HTMLInputElement>(null);

  const sheet = hf.getSheetId(names[tab])!;
  const { width, height } = hf.getSheetDimensions(sheet);
  const values = hf.getSheetValues(sheet);
  const header = height > 1 && (values[0] ?? []).every((v) => v == null || typeof v === "string");

  const pick = (row: number, col: number) => {
    if (row < 0 || col < 0) return;
    setSel({ row, col });
    setDraft(String(hf.getCellSerialized({ sheet, row, col }) ?? ""));
    input.current?.focus();
  };
  const commit = () => {
    if (!sel) return;
    const addr = { sheet, ...sel }, from = hf.getCellSerialized(addr);
    if (String(from ?? "") === draft) return;
    // Numbers are stored as numbers so the agent gets 5, not "5"; HyperFormula parses =formulas.
    const raw = draft.trim() === "" ? null : Number.isFinite(Number(draft)) ? Number(draft) : draft;
    try { hf.setCellContents(addr, [[raw]]); }
    catch (e) { setMsg(e instanceof Error ? e.message : String(e)); return; }
    const cell = a1(names[tab], sel.row, sel.col);
    changes.current.set(cell, { cell, from: changes.current.get(cell)?.from ?? from ?? null, to: hf.getCellSerialized(addr) ?? null, addr });
    setMsg(""); rerender((n) => n + 1);
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!sel) return;
    const move = ({ Enter: [1, 0], Tab: [0, 1], ArrowDown: [1, 0], ArrowUp: [-1, 0] } as Record<string, [number, number]>)[e.key];
    if (e.key === "Escape") setDraft(String(hf.getCellSerialized({ sheet, ...sel }) ?? ""));
    if (!move) return;
    e.preventDefault(); commit();
    const dir = e.shiftKey ? -1 : 1;
    pick(sel.row + move[0] * dir, sel.col + move[1] * dir);
  };
  const send = async (wake: boolean) => {
    commit();
    const list = [...changes.current.values()];
    const values = {
      changes: list.map(({ addr, ...c }) => ({ ...c, value: plain(hf.getCellValue(addr)) })),
      sheets: hf.getAllSheetsSerialized(),
      values: Object.fromEntries(Object.entries(hf.getAllSheetsValues()).map(([n, rows]) => [n, rows.map((r) => r.map(plain))])),
    };
    setMsg(wake ? "Sending…" : "Saving…");
    try {
      await submit({ action: "sheet", values, wake });
      changes.current.clear();
      setMsg(wake ? `Sent ${list.length} changes to the agent.` : "Saved.");
    } catch (e) { setMsg(`Not sent: ${e instanceof Error ? e.message : String(e)}`); }
  };

  const rows = Array.from({ length: Math.max(height, 1) }, (_, r) => r);
  const cols = Array.from({ length: Math.max(width, 1) }, (_, c) => c);
  return (
    <div style={{ display: "grid", gap: 6, fontSize: 13 }}>
      {names.length > 1 && (
        <div role="tablist" style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {names.map((n, i) => (
            <button key={n} role="tab" aria-selected={i === tab} onClick={() => { commit(); setTab(i); setSel(null); setDraft(""); }}
              style={{ ...button, background: i === tab ? "var(--muted)" : "transparent", fontWeight: i === tab ? 600 : 400 }}>{n}</button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <span style={{ minWidth: 44, fontFamily: "monospace", fontSize: 12, opacity: 0.7 }}>{sel ? colName(sel.col) + (sel.row + 1) : ""}</span>
        <input ref={input} aria-label="Cell value or formula" value={draft} disabled={!sel} placeholder={sel ? "" : "Click a cell to edit"}
          onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} onBlur={commit}
          style={{ flex: 1, fontFamily: "monospace", fontSize: 12, padding: "3px 6px", border: line, borderRadius: 4, background: "transparent", color: "inherit" }} />
      </div>
      <div style={{ overflow: "auto", maxHeight: 640, border: line, borderRadius: 4 }}>
        <table style={{ borderCollapse: "collapse", fontVariantNumeric: "tabular-nums", minWidth: "100%" }}>
          <thead>
            <tr><th style={{ ...head, top: 0, left: 0, zIndex: 2 }} />{cols.map((c) => <th key={c} style={{ ...head, top: 0, zIndex: 1 }}>{colName(c)}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <th style={{ ...head, left: 0, zIndex: 1, textAlign: "right" }}>{r + 1}</th>
                {cols.map((c) => {
                  const v = values[r]?.[c], err = v instanceof DetailedCellError, on = sel?.row === r && sel.col === c;
                  return (
                    <td key={c} onClick={() => pick(r, c)} title={err ? v.message || v.value : undefined}
                      style={{ border: line, padding: "2px 8px", whiteSpace: "nowrap", cursor: "cell", maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis",
                        textAlign: typeof v === "number" ? "right" : "left", fontWeight: header && r === 0 ? 600 : undefined,
                        color: err ? "var(--destructive)" : undefined, outline: on ? "2px solid var(--primary)" : undefined, outlineOffset: -2,
                        background: changes.current.has(a1(names[tab], r, c)) ? "color-mix(in oklch, var(--primary) 8%, transparent)" : undefined }}>
                      {show(v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button style={button} onClick={() => send(false)}>Save</button>
        <button style={{ ...button, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" }} onClick={() => send(true)}>Send to agent</button>
        <span style={{ fontSize: 12, opacity: 0.7 }}>{msg || (changes.current.size ? `${changes.current.size} changed cells` : "")}</span>
      </div>
    </div>
  );
}
