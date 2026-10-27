import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import skill from "../SKILL.md";

const issueId = { type: "string", description: "Paperclip task id ($PAPERCLIP_TASK_ID)." };
const fileId = { type: "number", description: "Odoo file id (dms.file) from doc_list." };
const secretRef = { type: "object", format: "secret-ref" };

const manifest: PaperclipPluginManifestV1 = {
  id: "shellkube.odoodocs",
  apiVersion: 1,
  version: "0.1.0",
  displayName: "Odoo documents (Shellkube)",
  description: "Files of the linked Odoo task on a Paperclip task: list, upload, edit in ONLYOFFICE, versions; agent tools.",
  author: "Shellkube",
  categories: ["connector", "ui"],
  capabilities: ["issues.read", "agent.tools.register", "secrets.read-ref", "skills.managed", "ui.detailTab.register"],
  entrypoints: { worker: "./dist/worker.js", ui: "./dist/ui" },
  instanceConfigSchema: {
    type: "object",
    required: ["odooUrl", "odooDb", "gatewayKey", "docsUrl"],
    properties: {
      odooUrl: { type: "string", title: "Odoo URL", default: "https://demo19.cpm-mini.shellkube.com" },
      odooDb: { type: "string", title: "Odoo database", default: "demo19" },
      gatewayKey: { ...secretRef, title: "Odoo API key of the gateway bot (paperclip-gateway)" },
      agentKeys: { type: "object", title: "Odoo API key per Paperclip agent id", additionalProperties: secretRef },
      docsUrl: { type: "string", title: "ONLYOFFICE Docs URL (browser)", default: "https://office.cpm-mini.shellkube.com" },
    },
  },
  tools: [
    { name: "doc_list", displayName: "Odoo docs: list",
      description: "List the Odoo files of the task linked to this Paperclip task (id, name, version_id, locked, editors).",
      parametersSchema: { type: "object", required: ["issueId"], properties: { issueId, query: { type: "string" } } } },
    { name: "doc_read", displayName: "Odoo docs: read",
      description: "Read a file (content_b64), the current version or versionId.",
      parametersSchema: { type: "object", required: ["fileId"], properties: { fileId, versionId: { type: "number" } } } },
    { name: "doc_write", displayName: "Odoo docs: write",
      description: "Save a new version. baseVersionId = the version_id you read. Returns status OK, LOCKED (someone is editing: do not retry in a loop) or CONFLICT (re-read and apply your change again).",
      parametersSchema: { type: "object", required: ["fileId", "contentB64", "baseVersionId"], properties: {
        fileId, contentB64: { type: "string" }, baseVersionId: { type: "number" }, note: { type: "string" } } } },
    { name: "doc_create", displayName: "Odoo docs: create",
      description: "Create a file on the linked Odoo task. Without contentB64 a .docx/.xlsx/.pptx name gives a blank file.",
      parametersSchema: { type: "object", required: ["issueId", "name"], properties: {
        issueId, name: { type: "string" }, contentB64: { type: "string" }, note: { type: "string" } } } },
    { name: "doc_comment", displayName: "Odoo docs: comment",
      description: "Post a plain-text note in the file's chatter (use this when the file is LOCKED).",
      parametersSchema: { type: "object", required: ["fileId", "body"], properties: { fileId, body: { type: "string" } } } },
  ],
  skills: [{ skillKey: "odoo-docs", displayName: "Odoo docs", description: "Work on the Odoo files of a task with the odoo-docs CLI.", markdown: skill }],
  ui: {
    slots: [{ type: "detailTab", id: "files", displayName: "Files", exportName: "FilesTab", entityTypes: ["issue"] }],
  },
};

export default manifest;
