import { describe, expect, it, beforeEach } from "vitest";
import { parsePiStdoutLine, resetParserState } from "./parse-stdout.js";

const ts = "2026-09-29T00:00:00.000Z";
const run = (events: unknown[]) => events.flatMap((e) => parsePiStdoutLine(JSON.stringify(e), ts));
const assistant = (text: string, thinking = "", extra: Record<string, unknown> = {}) => ({
  role: "assistant",
  content: [...(thinking ? [{ type: "thinking", thinking }] : []), { type: "text", text }],
  ...extra,
});

describe("parsePiStdoutLine", () => {
  beforeEach(() => resetParserState());

  it("shows streamed text and thinking once, not again from text_end/message_end/turn_end/agent_end", () => {
    const msg = assistant("Hello world", "hmm", { usage: { input: 10, output: 5, cacheRead: 100, cacheWrite: 7 } });
    const entries = run([
      { type: "agent_start" },
      { type: "message_start", message: { role: "assistant", content: [] } },
      { type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "hmm" } },
      { type: "message_update", assistantMessageEvent: { type: "thinking_end", content: "hmm" } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Hello " } },
      { type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "world" } },
      { type: "message_update", assistantMessageEvent: { type: "text_end", content: "Hello world" } },
      { type: "message_end", message: msg },
      { type: "turn_end", message: msg, toolResults: [] },
      { type: "agent_end", messages: [msg] },
    ]);
    expect(entries.filter((e) => e.kind === "assistant").map((e) => e.text)).toEqual(["Hello ", "world"]);
    expect(entries.filter((e) => e.kind === "thinking")).toHaveLength(1);
    const result = entries.find((e) => e.kind === "result");
    expect(result).toMatchObject({ inputTokens: 17, outputTokens: 5, cachedTokens: 100 });
  });

  it("falls back to the full message when nothing was streamed", () => {
    const msg = assistant("Final answer");
    const entries = run([{ type: "message_end", message: msg }, { type: "turn_end", message: msg }]);
    expect(entries.filter((e) => e.kind === "assistant").map((e) => e.text)).toEqual(["Final answer"]);
  });

  it("does not render tool results, harness context or prompts as assistant text", () => {
    const entries = run([
      { type: "message_end", message: { role: "user", content: [{ type: "text", text: "wake payload" }] } },
      { type: "message_end", message: { role: "custom", content: "[harness-digest]" } },
      { type: "tool_execution_start", toolCallId: "t1", toolName: "ipython", args: { code: "1" } },
      { type: "tool_execution_end", toolCallId: "t1", toolName: "ipython", result: { content: [{ type: "text", text: "1" }] } },
      { type: "message_end", message: { role: "toolResult", toolCallId: "t1", content: [{ type: "text", text: "1" }] } },
      { type: "turn_end", message: assistant(""), toolResults: [{ toolCallId: "t1", content: [{ type: "text", text: "1" }] }] },
    ]);
    expect(entries.filter((e) => e.kind === "assistant")).toHaveLength(0);
    expect(entries.filter((e) => e.kind === "tool_result")).toHaveLength(1);
    expect(entries.filter((e) => e.kind === "user").map((e) => e.text)).toEqual(["wake payload"]);
  });

  it("hides prime-agent session events and summarizes refine_complete", () => {
    const entries = run([
      { type: "session", id: "s1" },
      { type: "session_action_update", actions: { queuedCount: 1 } },
      { type: "refine_complete", result: { summary: "Saved a tactic" } },
    ]);
    expect(entries).toEqual([{ kind: "system", ts, text: "🧠 Harness refined: Saved a tactic" }]);
  });

  it("surfaces provider errors", () => {
    const entries = run([{ type: "message_end", message: assistant("", "", { stopReason: "error", errorMessage: "rate limited" }) }]);
    expect(entries).toContainEqual({ kind: "stderr", ts, text: "rate limited" });
  });
});
