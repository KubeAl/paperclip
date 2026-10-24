import { DetailedCellError, HyperFormula } from "hyperformula";

export type Cell = string | number | boolean | null;
export type Sheets = Record<string, Cell[][]>;

// Internal fork plugin, not distributed: HyperFormula's GPL-3 key fits.
export const buildSheets = (sheets: Sheets) => HyperFormula.buildFromSheets(sheets, { licenseKey: "gpl-v3" });

export function colName(col: number): string {
  let s = "";
  for (let n = col + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}
export const a1 = (sheet: string, row: number, col: number) =>
  `${/^[A-Za-z0-9_]+$/.test(sheet) ? sheet : `'${sheet.replace(/'/g, "''")}'`}!${colName(col)}${row + 1}`;

export const plain = (v: unknown) => (v instanceof DetailedCellError ? v.value : v);

export function cellErrors(hf: HyperFormula): string[] {
  const out: string[] = [];
  for (const name of hf.getSheetNames()) {
    hf.getSheetValues(hf.getSheetId(name)!).forEach((row, r) => row.forEach((v, c) => {
      if (v instanceof DetailedCellError) out.push(`${a1(name, r, c)} ${v.value}${v.message ? ` (${v.message})` : ""}`);
    }));
  }
  return out;
}
