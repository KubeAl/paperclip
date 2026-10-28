import type { PaperclipPluginManifestV1 } from "@paperclipai/plugin-sdk";
import skill from "../SKILL.md";

const issueId = { type: "string", description: "Paperclip task id ($PAPERCLIP_TASK_ID)." };
const fileId = { type: "number", description: "Odoo file id (dms.file) from doc_list." };
const pageId = { type: "number", description: "Knowledge page id (document.page) from kb_search." };
const secretRef = { type: "object", format: "secret-ref" };
const obj = (required: string[], properties: Record<string, unknown>) => ({ type: "object", required, properties });

const manifest: PaperclipPluginManifestV1 = {
  id: "shellkube.odoodocs",
  apiVersion: 1,
  version: "0.4.0",
  displayName: "Odoo documents (Shellkube)",
  description: "Files of the linked Odoo task on a Paperclip task: list, create, edit in ONLYOFFICE, versions, PDF, share, requests; agent tools for files and Knowledge pages.",
  author: "Shellkube",
  categories: ["connector", "ui"],
  capabilities: ["issues.read", "issues.update", "issues.wakeup", "issue.comments.create", "issue.comments.create_human_attributed",
    "agents.read", "agents.invoke", "plugin.state.read", "plugin.state.write", "webhooks.receive",
    "agent.tools.register", "secrets.read-ref", "skills.managed", "ui.detailTab.register"],
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
      webhookSecret: { ...secretRef, title: "Odoo webhook secret (HMAC, same as in Odoo Settings)" },
    },
  },
  webhooks: [{ endpointKey: "odoo", displayName: "Odoo document events", description: "version/created/deleted/locked/unlocked, HMAC-signed" }],
  tools: [
    { name: "doc_list", displayName: "Odoo docs: list",
      description: "List the Odoo files of the task linked to this Paperclip task (id, name, version_id, locked, editors, author_name).",
      parametersSchema: obj(["issueId"], { issueId, query: { type: "string" } }) },
    { name: "doc_read", displayName: "Odoo docs: read",
      description: "Read a file (content_b64), the current version or versionId. Diagrams (.excalidraw) also return text: their labels and arrows as \"A -> B\".",
      parametersSchema: obj(["fileId"], { fileId, versionId: { type: "number" } }) },
    { name: "doc_write", displayName: "Odoo docs: write",
      description: "Save a new version. baseVersionId = the version_id you read. Returns status OK, LOCKED (someone is editing: stop, you are woken when it is free) or CONFLICT (re-read and apply your change again).",
      parametersSchema: obj(["fileId", "contentB64", "baseVersionId"], {
        fileId, contentB64: { type: "string" }, baseVersionId: { type: "number" }, note: { type: "string" }, issueId }) },
    { name: "doc_create", displayName: "Odoo docs: create",
      description: "Create a file on the linked Odoo task: from contentB64, from a template (templateId from doc_templates), blank (.docx/.xlsx/.pptx/.excalidraw name), or a diagram from Mermaid (name ending in .excalidraw).",
      parametersSchema: obj(["issueId", "name"], {
        issueId, name: { type: "string" }, contentB64: { type: "string" }, templateId: { type: "number" }, note: { type: "string" },
        mermaid: { type: "string", description: "Mermaid source (flowchart, sequence...). Becomes an Excalidraw drawing when a person opens it." } }) },
    { name: "doc_comment", displayName: "Odoo docs: comment",
      description: "Post a plain-text note in the file's chatter.",
      parametersSchema: obj(["fileId", "body"], { fileId, body: { type: "string" } }) },
    { name: "doc_templates", displayName: "Odoo docs: templates",
      description: "List the document templates (id, name, mimetype) for doc_create templateId.",
      parametersSchema: obj([], {}) },
    { name: "doc_export_pdf", displayName: "Odoo docs: export PDF",
      description: "Convert a file to PDF in Odoo (saved as <name>.pdf next to it, or a new version of that PDF).",
      parametersSchema: obj(["fileId"], { fileId }) },
    { name: "doc_share", displayName: "Odoo docs: share link",
      description: "Create a public view/download link for a file. Only when the task asks for a link to share.",
      parametersSchema: obj(["fileId"], { fileId, expires: { type: "string", description: "YYYY-MM-DD" }, password: { type: "string" } }) },
    { name: "doc_request", displayName: "Odoo docs: request a file",
      description: "Ask a person (Odoo user login or contact email) to upload a file to the linked Odoo task. Returns upload_url.",
      parametersSchema: obj(["issueId", "name"], { issueId, name: { type: "string" }, userLogin: { type: "string" },
        partnerEmail: { type: "string" }, deadline: { type: "string", description: "YYYY-MM-DD" }, note: { type: "string" } }) },
    { name: "kb_search", displayName: "Odoo Knowledge: search",
      description: "Search the Odoo Knowledge pages you may read (title and text). Returns id, name, parent, tags, history_id, locked, pending_approval, odoo_url.",
      parametersSchema: obj([], { query: { type: "string" }, limit: { type: "number" } }) },
    { name: "kb_read", displayName: "Odoo Knowledge: read",
      description: "Read a Knowledge page as markdown, with history_id (the base for kb_write).",
      parametersSchema: obj(["pageId"], { pageId }) },
    { name: "kb_write", displayName: "Odoo Knowledge: write",
      description: "With pageId: append markdown to the page, or replace one section (section = its heading text; the markdown replaces that heading and its text). baseHistoryId = the history_id you read. Without pageId: create a page (name, parentId). Returns OK (state approved = live, to approve = waits for an approver), LOCKED or CONFLICT (re-read and apply your change again).",
      parametersSchema: obj(["markdown"], { markdown: { type: "string" }, pageId, baseHistoryId: { type: "number" },
        section: { type: "string" }, name: { type: "string" }, parentId: { type: "number" }, summary: { type: "string", description: "One line: what you changed (shown to approvers)." }, issueId }) },
  ],
  skills: [{ skillKey: "odoo-docs", displayName: "Odoo docs", description: "Work on the Odoo files of a task with the odoo-docs CLI.", markdown: skill }],
  ui: {
    slots: [{ type: "detailTab", id: "files", displayName: "Odoo files", exportName: "FilesTab", entityTypes: ["issue"] }],
  },
};

export default manifest;
