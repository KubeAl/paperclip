import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";

const issueId = { type: "string", description: "Task id ($PAPERCLIP_TASK_ID)." };
const panel = { type: "string", description: "Panel name, default \"main\". Letters, digits, - and _." };

const manifest: PaperclipPluginManifestV1 = {
  id: "shellkube.livepanel",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Live panel (Shellkube)",
  description: "Agents show live HTML on a task or chat (progress, forms, tables) and get the user's input back.",
  author: "Shellkube",
  categories: ["ui", "automation"],
  capabilities: [
    "issues.read", "issue.comments.create", "issue.comments.create_human_attributed",
    "plugin.state.read", "plugin.state.write", "agent.tools.register", "ui.detailTab.register",
  ],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  tools: [
    {
      name: "live_render", displayName: "Live panel: render",
      description: "Show or replace an HTML panel on the task. The page updates in place (typed input is kept). Empty html removes the panel. Forms submit to the agent; see live_input.",
      parametersSchema: { type: "object", required: ["issueId", "html"], properties: {
        issueId, panel, title: { type: "string" }, html: { type: "string" },
        data: { type: "object", description: "Initial data for [data-bind] elements and paperclip.onData." } } },
    },
    {
      name: "live_patch", displayName: "Live panel: patch",
      description: "Change part of a panel without re-sending it: ops on CSS selectors and/or a shallow data merge.",
      parametersSchema: { type: "object", required: ["issueId"], properties: {
        issueId, panel,
        ops: { type: "array", items: { type: "object", properties: {
          target: { type: "string", description: "CSS selector; default body." },
          mode: { type: "string", enum: ["inner", "outer", "append", "prepend", "text", "remove"] },
          html: { type: "string" } } } },
        data: { type: "object" } } },
    },
    {
      name: "live_input", displayName: "Live panel: read input",
      description: "Read what the user submitted on a panel after sequence number `after`. waitSeconds (max 25) waits for the next submit.",
      parametersSchema: { type: "object", required: ["issueId"], properties: {
        issueId, panel, after: { type: "number" }, waitSeconds: { type: "number" } } },
    },
  ],
  ui: {
    slots: [
      { type: "taskDetailView", id: "panels", displayName: "Live panel", exportName: "LivePanels", entityTypes: ["issue"] },
    ],
  },
};

export default manifest;
