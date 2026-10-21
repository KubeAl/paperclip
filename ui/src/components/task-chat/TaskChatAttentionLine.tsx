import { useEffect, useState } from "react";
import { CircleAlert, Hourglass } from "lucide-react";
import type { IssueThreadInteraction } from "@paperclipai/shared";
import type { TranscriptEntry } from "@/adapters";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const QUIET_MS = 3 * 60_000;
const LONG_STEP_MS = 5 * 60_000;
const REPEAT_LIMIT = 3;

export interface AttentionSignal {
  tone: "warning" | "waiting";
  text: string;
}

function minutes(ms: number): string {
  return `${Math.max(1, Math.floor(ms / 60_000))} min`;
}

function age(ms: number): string {
  if (ms < 60 * 60_000) return minutes(ms);
  if (ms < 48 * 60 * 60_000) return `${Math.floor(ms / (60 * 60_000))} h`;
  return `${Math.floor(ms / (24 * 60 * 60_000))} days`;
}

/** Signs that a live run is stuck: long silence, one very long step, or a repeated step. */
export function liveRunAttention(
  entries: readonly TranscriptEntry[],
  runStartMs: number | null,
  nowMs: number,
): AttentionSignal | null {
  let lastMs = runStartMs ?? 0;
  const inputs = new Map<string, string>();
  const results = new Map<string, string>();
  let openCall: { id: string; ms: number } | null = null;
  for (const entry of entries) {
    const ms = Date.parse(entry.ts);
    if (Number.isFinite(ms)) lastMs = Math.max(lastMs, ms);
    if (entry.kind === "tool_call") {
      const id = entry.toolUseId ?? entry.ts;
      if (!inputs.has(id)) {
        inputs.set(id, `${entry.name}:${JSON.stringify(entry.input ?? null)}`);
        openCall = { id, ms };
      }
    } else if (entry.kind === "tool_result" && !entry.delta) {
      results.set(entry.toolUseId, entry.content);
      if (openCall?.id === entry.toolUseId) openCall = null;
    }
  }
  if (lastMs > 0) {
    if (openCall && nowMs - openCall.ms >= LONG_STEP_MS) {
      return { tone: "warning", text: `This step has been running for ${minutes(nowMs - openCall.ms)}. It may be stuck.` };
    }
    if (!openCall && nowMs - lastMs >= QUIET_MS) {
      return { tone: "warning", text: `No output for ${minutes(nowMs - lastMs)}. The agent may be stuck.` };
    }
  }
  const repeats = new Map<string, number>();
  for (const [id, input] of inputs) {
    if (!results.has(id)) continue;
    const key = `${input}\u0000${results.get(id)}`;
    repeats.set(key, (repeats.get(key) ?? 0) + 1);
  }
  const most = Math.max(0, ...repeats.values());
  if (most >= REPEAT_LIMIT) {
    return { tone: "warning", text: `Repeated the same step ${most} times with the same result. It may be going in circles.` };
  }
  return null;
}

/** Who the oldest open card or question waits for, and for how long. */
export function waitingAttention(
  interactions: readonly IssueThreadInteraction[],
  currentUserId: string | null | undefined,
  userLabelMap: ReadonlyMap<string, string> | null | undefined,
  nowMs: number,
): AttentionSignal | null {
  const pending = interactions
    .filter((interaction) => interaction.status === "pending")
    .sort((a, b) => Date.parse(String(a.createdAt)) - Date.parse(String(b.createdAt)))[0];
  if (!pending) return null;
  const who = !pending.addresseeUserId || pending.addresseeUserId === currentUserId
    ? "you"
    : userLabelMap?.get(pending.addresseeUserId) ?? "someone else";
  const waited = nowMs - Date.parse(String(pending.createdAt));
  // The card itself is docked right below; this line only adds who and how long.
  if (waited < 60_000) return null;
  return { tone: "waiting", text: `Waiting for ${who} · ${age(waited)}` };
}

/** Re-renders every 15 s while `active`, so time-based signals appear on their own. */
export function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export function TaskChatAttentionLine({ signal, onStop }: { signal: AttentionSignal; onStop?: () => void }) {
  const Icon = signal.tone === "warning" ? CircleAlert : Hourglass;
  return (
    <div
      role="status"
      data-testid="task-chat-attention-line"
      className={cn(
        "mx-auto flex max-w-(--sz-turn-status-island) items-center gap-2 rounded-full border px-3 py-1 text-sm shadow-sm",
        signal.tone === "warning"
          ? "border-amber-500/40 bg-amber-50 text-amber-900 dark:bg-amber-950/60 dark:text-amber-100"
          : "border-border bg-popover/95 text-foreground",
      )}
    >
      <Icon className="size-4 shrink-0" aria-hidden />
      <span className="min-w-0 truncate" title={signal.text}>{signal.text}</span>
      {onStop ? (
        <Button size="sm" variant="ghost" className="h-6 shrink-0 px-2" onClick={onStop}>Stop</Button>
      ) : null}
    </div>
  );
}
