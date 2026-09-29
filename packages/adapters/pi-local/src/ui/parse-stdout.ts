import type { TranscriptEntry } from "@paperclipai/adapter-utils";

// Pi (and pi-compatible CLIs such as prime-agent) stream the same text several times:
// message_update deltas, then text_end/thinking_end, then message_end, turn_end and agent_end
// each carry the full message again. Show each piece once: prefer the streamed deltas, fall
// back to the first full copy only when nothing was streamed.

type ContentPart = { type?: string; text?: string; thinking?: string };

function safeJsonParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function extractTextContent(content: unknown): { text: string; thinking: string } {
  if (typeof content === "string") return { text: content, thinking: "" };
  if (!Array.isArray(content)) return { text: "", thinking: "" };
  let text = "";
  let thinking = "";
  for (const c of content as ContentPart[]) {
    if (c?.type === "text" && c.text) text += c.text;
    if (c?.type === "thinking" && c.thinking) thinking += c.thinking;
  }
  return { text, thinking };
}

function toolResultText(result: unknown): string {
  if (typeof result === "string") return result;
  if (Array.isArray(result)) {
    return extractTextContent(result).text || JSON.stringify(result);
  }
  const record = asRecord(result);
  if (record && Array.isArray(record.content)) {
    return extractTextContent(record.content).text || JSON.stringify(result);
  }
  return result === undefined ? "" : JSON.stringify(result) ?? String(result);
}

// Per-run parser state (reset between transcripts via resetParserState).
const state = {
  pendingToolCalls: new Map<string, { toolName: string; args: unknown }>(),
  finishedToolCalls: new Set<string>(),
  // What the current assistant message already showed.
  streamed: { text: false, thinking: false },
  shown: { text: false, thinking: false },
  // What the current turn already showed (turn_end fallback).
  turnShown: false,
  lastAssistantText: "",
  usage: { input: 0, output: 0, cached: 0, cost: 0 },
};

function resetMessage(): void {
  state.streamed = { text: false, thinking: false };
  state.shown = { text: false, thinking: false };
}

export function resetParserState(): void {
  state.pendingToolCalls.clear();
  state.finishedToolCalls.clear();
  resetMessage();
  state.turnShown = false;
  state.lastAssistantText = "";
  state.usage = { input: 0, output: 0, cached: 0, cost: 0 };
}

function addUsage(usageValue: unknown): void {
  const usage = asRecord(usageValue);
  if (!usage) return;
  // Cache writes are billed prompt tokens, so they count as input (same as claude_local).
  state.usage.input += asNumber(usage.inputTokens ?? usage.input) + asNumber(usage.cacheWrite);
  state.usage.output += asNumber(usage.outputTokens ?? usage.output);
  state.usage.cached += asNumber(usage.cacheRead ?? usage.cachedInputTokens);
  state.usage.cost += asNumber(asRecord(usage.cost)?.total ?? usage.costUsd);
}

/** Emit full text/thinking from a finished assistant message, skipping what was already shown. */
function fullMessageEntries(message: Record<string, unknown>, ts: string): TranscriptEntry[] {
  const entries: TranscriptEntry[] = [];
  const { text, thinking } = extractTextContent(message.content);
  if (thinking && !state.streamed.thinking && !state.shown.thinking) {
    entries.push({ kind: "thinking", ts, text: thinking });
  }
  if (text && !state.streamed.text && !state.shown.text) {
    entries.push({ kind: "assistant", ts, text });
  }
  if (text) state.lastAssistantText = text;
  if (message.stopReason === "error") {
    const error = asString(message.errorMessage).trim() || "Provider request failed.";
    entries.push({ kind: "stderr", ts, text: error });
  }
  if (entries.length > 0 || state.streamed.text || state.streamed.thinking || state.shown.text || state.shown.thinking) {
    state.turnShown = true;
  }
  return entries;
}

function toolResultEntry(toolCallId: string, toolNameHint: string, result: unknown, isError: boolean, ts: string): TranscriptEntry[] {
  if (state.finishedToolCalls.has(toolCallId)) return [];
  state.finishedToolCalls.add(toolCallId);
  const pending = state.pendingToolCalls.get(toolCallId);
  state.pendingToolCalls.delete(toolCallId);
  return [{
    kind: "tool_result",
    ts,
    toolUseId: toolCallId,
    toolName: toolNameHint || pending?.toolName || "tool",
    content: toolResultText(result),
    isError,
  }];
}

export function parsePiStdoutLine(line: string, ts: string): TranscriptEntry[] {
  const parsed = asRecord(safeJsonParse(line));
  if (!parsed) {
    const trimmed = line.trim();
    if (!trimmed) return [];
    return [{ kind: "stdout", ts, text: trimmed }];
  }

  const type = asString(parsed.type);

  switch (type) {
    // RPC plumbing and noisy lifecycle/progress events.
    case "response":
    case "extension_ui_request":
    case "extension_ui_response":
    case "extension_error":
    case "session":
    case "session_action_update":
    case "turn_start":
    case "tool_execution_update":
      return [];

    case "agent_start":
      resetParserState();
      return [{ kind: "system", ts, text: "🚀 Pi agent started" }];

    case "message_start": {
      const message = asRecord(parsed.message);
      if (message?.role === "assistant") resetMessage();
      return [];
    }

    case "message_update": {
      const event = asRecord(parsed.assistantMessageEvent);
      if (!event) return [];
      const eventType = asString(event.type);
      if (eventType === "text_delta" || eventType === "thinking_delta") {
        const delta = asString(event.delta);
        if (!delta) return [];
        const kind = eventType === "text_delta" ? "assistant" : "thinking";
        state.streamed[kind === "assistant" ? "text" : "thinking"] = true;
        state.turnShown = true;
        return [{ kind, ts, text: delta, delta: true }];
      }
      if (eventType === "text_end" || eventType === "thinking_end") {
        const key = eventType === "text_end" ? "text" : "thinking";
        const content = asString(event.content);
        if (!content || state.streamed[key]) return [];
        state.shown[key] = true;
        state.turnShown = true;
        return [{ kind: key === "text" ? "assistant" : "thinking", ts, text: content }];
      }
      return [];
    }

    case "message_end": {
      const message = asRecord(parsed.message);
      if (!message) return [];
      const role = asString(message.role);
      if (role === "assistant") {
        const entries = fullMessageEntries(message, ts);
        resetMessage();
        return entries;
      }
      if (role === "user") {
        const { text } = extractTextContent(message.content);
        return text ? [{ kind: "user", ts, text }] : [];
      }
      // toolResult messages duplicate tool_execution_end; custom messages are harness context.
      return [];
    }

    case "turn_end": {
      const entries: TranscriptEntry[] = [];
      const message = asRecord(parsed.message);
      if (message) {
        addUsage(message.usage);
        // Only a fallback: normally message_end/deltas already showed this turn's text.
        if (!state.turnShown && message.role === "assistant") entries.push(...fullMessageEntries(message, ts));
        const { text } = extractTextContent(message.content);
        if (text) state.lastAssistantText = text;
      }
      const toolResults = parsed.toolResults;
      if (Array.isArray(toolResults)) {
        for (const tr of toolResults) {
          const record = asRecord(tr);
          if (!record) continue;
          const id = asString(record.toolCallId);
          if (!id) continue;
          entries.push(...toolResultEntry(id, asString(record.toolName), record.content, record.isError === true, ts));
        }
      }
      state.turnShown = false;
      resetMessage();
      return entries;
    }

    case "agent_end": {
      const entries: TranscriptEntry[] = [];
      const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
      const last = asRecord(messages[messages.length - 1]);
      if (last?.role === "assistant") {
        const { text } = extractTextContent(last.content);
        if (text && text !== state.lastAssistantText) entries.push({ kind: "assistant", ts, text });
        // Streams without turn_end usage: fall back to the final message's usage.
        if (state.usage.input === 0 && state.usage.output === 0) addUsage(last.usage);
      }
      const { input, output, cached, cost } = state.usage;
      if (input > 0 || output > 0) {
        entries.push({
          kind: "result",
          ts,
          text: "Run completed",
          inputTokens: input,
          outputTokens: output,
          cachedTokens: cached,
          costUsd: cost,
          subtype: "end",
          isError: false,
          errors: [],
        });
      } else {
        entries.push({ kind: "system", ts, text: "✅ Pi agent finished" });
      }
      return entries;
    }

    case "tool_execution_start": {
      const toolCallId = asString(parsed.toolCallId, `tool-${Date.now()}`);
      const toolName = asString(parsed.toolName, "tool");
      state.pendingToolCalls.set(toolCallId, { toolName, args: parsed.args });
      return [{ kind: "tool_call", ts, name: toolName, input: parsed.args, toolUseId: toolCallId }];
    }

    case "tool_execution_end": {
      const toolCallId = asString(parsed.toolCallId, `tool-${Date.now()}`);
      return toolResultEntry(toolCallId, asString(parsed.toolName), parsed.result, parsed.isError === true, ts);
    }

    case "auto_retry_end":
      return parsed.success === true
        ? []
        : [{ kind: "stderr", ts, text: asString(parsed.finalError).trim() || "Automatic retries exhausted." }];

    case "error": {
      const message = asString(parsed.message).trim();
      return message ? [{ kind: "stderr", ts, text: message }] : [];
    }

    // prime-agent: continual-harness refinement finished.
    case "refine_complete": {
      const result = asRecord(parsed.result);
      const summary = asString(result?.summary).trim();
      return summary ? [{ kind: "system", ts, text: `🧠 Harness refined: ${summary}` }] : [];
    }

    default:
      return [{ kind: "stdout", ts, text: line }];
  }
}
