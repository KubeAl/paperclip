/**
 * Plain-language label for a Python code cell tool call (`ipython`), so the live row says "Querying Odoo · smiv19" instead of
 * "Running Ipython · code: import os…". Returns null when nothing matches;
 * callers then keep the generic tool row.
 */
export interface CodeStep {
  running: string;
  done: string;
  target?: string;
}

const MAX_TARGET = 80;

function clip(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > MAX_TARGET ? `${line.slice(0, MAX_TARGET - 1)}…` : line;
}

function fileName(path: string): string {
  const clean = path.replace(/^[{(]+|[})]+$/g, "");
  return clean.split("/").filter(Boolean).at(-1) ?? clean;
}

function unique(values: string[], max = 3): string | undefined {
  const list = [...new Set(values)];
  if (list.length === 0) return undefined;
  return list.length > max ? `${list.slice(0, max).join(", ")} +${list.length - max}` : list.join(", ");
}

export function describeCodeStep(code: string): CodeStep | null {
  const odoo = code.match(/odoo-run\s+([\w{}-]+)(?:[^\n"]*?(--write|--try|--sql))?/);
  if (odoo) {
    const db = odoo[1].includes("{") ? undefined : odoo[1];
    if (odoo[2] === "--write") return { running: "Applying a change in Odoo", done: "Changed Odoo", target: db };
    if (odoo[2] === "--try") return { running: "Testing a change in Odoo (rolled back)", done: "Tested a change in Odoo", target: db };
    return { running: "Querying Odoo", done: "Queried Odoo", target: db };
  }
  if (/\brlm\.harness\.(create|update|delete)_/.test(code)) return { running: "Saving notes", done: "Saved notes" };
  if (/\bgit\s+(commit|push)\b/.test(code)) return { running: "Committing code", done: "Committed code" };
  const api = [...code.matchAll(/\bpc\(\s*["'](GET|POST|PATCH|PUT|DELETE)["']\s*,\s*f?["']([^"']+)/g)];
  if (api.length > 0) {
    const writes = api.filter((call) => call[1] !== "GET");
    if (writes.some((call) => /\/comments\b/.test(call[2]))) return { running: "Posting a reply", done: "Posted a reply" };
    if (writes.some((call) => /\/interactions\b/.test(call[2]))) return { running: "Asking you to confirm", done: "Asked you to confirm" };
    if (writes.some((call) => call[1] === "POST" && /\/issues\/?$/.test(call[2]))) return { running: "Creating a task", done: "Created a task" };
    if (writes.length > 0) return { running: "Updating the task", done: "Updated the task" };
    return { running: "Reading Paperclip", done: "Read Paperclip", target: unique(api.map((call) => call[2].replace(/\{[^}]*\}/g, "…").split("?")[0])) };
  }
  const edits = [
    ...[...code.matchAll(/\bedit(?:\.run)?\(\s*(?:path\s*=\s*)?f?["']([^"']+)["']/g)].map((m) => m[1]),
    ...[...code.matchAll(/\bopen\(\s*f?["']([^"']+)["']\s*,\s*["'][wa]/g)].map((m) => m[1]),
  ];
  if (edits.length > 0 || /\bedit(?:\.run)?\(|\.write_text\(|\bopen\([^)]*,\s*["'][wa]["']/.test(code)) {
    return { running: "Editing files", done: "Edited files", target: unique(edits.map(fileName)) };
  }
  if (/\bwebsearch\b/.test(code)) return { running: "Searching the web", done: "Searched the web" };
  if (/\bkubectl\b/.test(code)) return { running: "Checking the cluster", done: "Checked the cluster" };
  if (/\b(pytest|vitest|pnpm\s+test|npm\s+test|--test-enable|\w+_test\.py)\b/.test(code)) return { running: "Running tests", done: "Ran tests" };
  const grep = code.match(/\b(?:grep|rg)\s+(?:-\w+\s+)*["']?([^"'\s|]+)/);
  if (grep || /\bfind\s+\S+\s+-name\b/.test(code)) {
    return { running: "Searching code", done: "Searched code", target: grep ? clip(grep[1]) : undefined };
  }
  const reads = [
    ...[...code.matchAll(/\bopen\(\s*f?["']([^"']+)["']\s*\)/g)].map((m) => m[1]),
    ...[...code.matchAll(/\b(?:cat|sed\s+-n\s+\S+|head|tail)\s+(?:-\S+\s+)*([~/.{][^\s"'|;]*)/g)].map((m) => m[1]),
  ];
  if (reads.length > 0 || /\bopen\([^)]*\)\.read\(\)/.test(code)) {
    return { running: "Reading files", done: "Read files", target: unique(reads.map(fileName)) };
  }
  const models = [...code.matchAll(/\benv\[\s*["']([\w.]+)["']\s*\]/g)].map((m) => m[1]);
  if (models.length > 0) return { running: "Preparing an Odoo script", done: "Prepared an Odoo script", target: unique(models) };
  const tables = [...code.matchAll(/\bfrom\s+([a-z_][\w.]*)/gi)].map((m) => m[1]).filter((t) => t.includes("_"));
  if (/\bselect\b/i.test(code) && tables.length > 0) return { running: "Preparing a query", done: "Prepared a query", target: unique(tables) };
  if (/\b(httpx|requests|urllib\.request|curl)\b/.test(code) && /https?:\/\//.test(code)) return { running: "Calling a web API", done: "Called a web API" };
  const shell = code.match(/\bbash\(\s*f?(?:"{3}|'{3}|"|')\s*([^\n"']+)/);
  if (shell) return { running: "Running a command", done: "Ran commands", target: clip(shell[1]) };
  if (/^\s*(print\(|for |\w+\s*=\s*\w+\[|\w+\s*=\s*await\s+\w+\s*$)/m.test(code) && !/\bdef\s/.test(code)) return { running: "Checking results", done: "Checked results" };
  return null;
}
