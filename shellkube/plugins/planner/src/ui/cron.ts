// Minimal 5-field cron expander (minute hour day-of-month month day-of-week), enough for routine previews.
function parseField(field: string, min: number, max: number): Set<number> | null {
  if (field === "*" || field === "?") return null; // null = any
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const [range, stepStr] = part.split("/");
    const step = stepStr ? Math.max(1, parseInt(stepStr, 10)) : 1;
    let lo = min, hi = max;
    if (range !== "*") {
      const [a, b] = range.split("-");
      lo = parseInt(a, 10);
      hi = b !== undefined ? parseInt(b, 10) : (stepStr ? max : lo);
    }
    for (let v = lo; v <= hi; v += step) if (v >= min && v <= max) out.add(v === 7 && max === 7 ? 0 : v);
  }
  return out;
}

function tzOffsetMs(utcMs: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(utcMs));
  const get = (t: string) => parseInt(parts.find((p) => p.type === t)!.value, 10);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - utcMs;
}

function zonedToUtc(y: number, m: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, m - 1, d, h, mi);
  return guess - tzOffsetMs(guess - tzOffsetMs(guess, tz), tz);
}

/** Occurrences (UTC ms) of `expr` in timezone `tz` between two ISO dates (inclusive, in tz wall time). Capped. */
export function expandCron(expr: string, tz: string, fromIso: string, toIso: string, cap = 2000): number[] {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5) return [];
  const [mi, h, dom, mon, dow] = [parseField(f[0], 0, 59), parseField(f[1], 0, 23), parseField(f[2], 1, 31),
    parseField(f[3], 1, 12), parseField(f[4], 0, 7)];
  const minutes = mi ? [...mi].sort((a, b) => a - b) : Array.from({ length: 60 }, (_, i) => i);
  const hours = h ? [...h].sort((a, b) => a - b) : Array.from({ length: 24 }, (_, i) => i);
  const out: number[] = [];
  const [fy, fm, fd] = fromIso.split("-").map(Number);
  const [ty, tm, td] = toIso.split("-").map(Number);
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86400000) {
    const day = new Date(t);
    const Y = day.getUTCFullYear(), M = day.getUTCMonth() + 1, D = day.getUTCDate(), W = day.getUTCDay();
    if (mon && !mon.has(M)) continue;
    const domOk = !dom || dom.has(D), dowOk = !dow || dow.has(W);
    if (dom && dow ? !(domOk || dowOk) : !(domOk && dowOk)) continue;
    for (const hh of hours) for (const mm of minutes) {
      out.push(zonedToUtc(Y, M, D, hh, mm, tz));
      if (out.length >= cap) return out;
    }
  }
  return out;
}
