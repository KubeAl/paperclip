import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest";
import plugin, { sign } from "../src/worker";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const ref = (secretId: string) => ({ type: "secret_ref", secretId });
const config = { odooUrl: "https://odoo.test", odooDb: "demo19", docsUrl: "https://docs.test",
  gatewayKey: ref("gw"), agentKeys: { [agentId]: ref("ratchet") }, webhookSecret: ref("hook") };
const user = { actor: { type: "user" as const, userId: "u1", userEmail: "alice@example.com", companyId }, companyId };
const run = { agentId, companyId, runId: "r1", projectId: "p1" };

let h: TestHarness;
let calls: Array<{ url: string; auth: string; db: string; body: Record<string, unknown> }>;
let reply: (method: string) => { status?: number; json: unknown };
let resolved: string[];

beforeEach(async () => {
  h = createTestHarness({ manifest, config, capabilities: [...manifest.capabilities!, "issue.comments.read"] });
  h.seed({
    issues: [{ id: issueId, companyId, identifier: "SHEA-1", status: "backlog", assigneeAgentId: null } as never],
    agents: [{ id: agentId, companyId, name: "Ratchet", status: "idle" } as never],
    accessMembers: [{ companyId, principalType: "user", principalId: "u1", status: "active", membershipRole: "owner" } as never],
  });
  resolved = [];
  h.ctx.secrets.resolve = async (r) => { const id = (r as { secretId: string }).secretId; resolved.push(id); return `key-${id}`; };
  calls = [];
  reply = () => ({ json: { status: "OK", files: [{ id: 7, name: "a.docx" }] } });
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    const h = init.headers as Record<string, string>;
    calls.push({ url, auth: h.Authorization, db: h["X-Odoo-Database"], body: JSON.parse(String(init.body)) });
    const r = reply(url.split("/").pop()!);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  });
  await plugin.definition.setup(h.ctx);
});
afterEach(() => vi.unstubAllGlobals());

const link = async () => { await h.performAction("link", { issueId, taskId: 42 }, user); calls = []; };
const comments = () => h.ctx.issues.listComments(issueId, companyId);
const webhook = (ev: Record<string, unknown>, secret = "key-hook") => {
  const rawBody = JSON.stringify({ db: "demo19", res_model: "project.task", res_id: 42, ...ev });
  return plugin.definition.onWebhook!({ endpointKey: "odoo", rawBody, requestId: "q", headers: { "x-shellkube-signature": sign(rawBody, secret) } });
};

describe("Files tab actions", () => {
  it("links, lists and unlinks as the signed-in user through the gateway key", async () => {
    expect(await h.getData("link", { companyId, issueId })).toMatchObject({ taskId: null });
    await h.performAction("link", { issueId, taskId: 42 }, user);
    expect(calls[0]).toEqual({ url: "https://odoo.test/json/2/dms.file/agent_list", auth: "bearer key-gw", db: "demo19",
      body: { res_model: "project.task", res_id: 42, as_login: "alice@example.com" } });
    expect(await h.getData("link", { companyId, issueId })).toMatchObject({ taskId: 42 });
    expect(await h.performAction("list", { issueId }, user)).toMatchObject({ taskId: 42, files: [{ id: 7 }] });

    await h.performAction("link", { issueId, taskId: 43 }, user);
    expect(await h.getData("link", { companyId, issueId })).toMatchObject({ taskId: 43 });
    await h.performAction("unlink", { issueId }, user);
    expect(await h.performAction("list", { issueId }, user)).toEqual({ taskId: null, status: "OK", files: [] });
  });

  it("does not link a task the user cannot see", async () => {
    reply = () => ({ status: 403, json: { name: "odoo.exceptions.AccessError", message: "No access", debug: "Traceback secret stuff" } });
    await expect(h.performAction("link", { issueId, taskId: 42 }, user)).rejects.toThrow("Odoo agent_list: HTTP 403: No access");
    expect(await h.getData("link", { companyId, issueId })).toMatchObject({ taskId: null });
  });

  it("needs a user actor with an email", async () => {
    for (const actor of [{ ...user.actor, userEmail: null }, { type: "agent" as const, agentId, companyId }])
      await expect(h.performAction("list", { issueId }, { actor, companyId })).rejects.toThrow("Only signed-in users");
    expect(calls).toEqual([]);
  });

  it("passes the person's login to every phase 2 method", async () => {
    await link();
    const as_login = "alice@example.com";
    await h.performAction("create", { issueId, name: "Offer.docx", templateId: 5 }, user);
    await h.performAction("write", { fileId: 7, contentB64: "aGk=", baseVersionId: 3 }, user);
    await h.performAction("export-pdf", { fileId: 7 }, user);
    await h.performAction("share", { fileId: 7, expires: "2026-12-31", password: "" }, user);
    await h.performAction("request", { issueId, name: "Signed contract", partnerEmail: "bob@example.com", deadline: "" }, user);
    await h.performAction("templates", {}, user);
    expect(calls.map((c) => [c.url.split("/").pop(), c.body])).toEqual([
      ["agent_create", { res_model: "project.task", res_id: 42, name: "Offer.docx", content_b64: null, template_id: 5, note: "from Paperclip", as_login }],
      ["agent_write", { ids: [7], content_b64: "aGk=", base_version_id: 3, note: "from Paperclip", as_login }],
      ["agent_export_pdf", { ids: [7], as_login }],
      ["agent_share", { ids: [7], expires: "2026-12-31", password: null, as_login }],
      ["agent_request", { res_model: "project.task", res_id: 42, name: "Signed contract", user_login: null, partner_email: "bob@example.com", deadline: null, note: "", as_login }],
      ["agent_templates", { as_login }],
    ]);
    await expect(h.performAction("request", { issueId, name: "x" }, user)).rejects.toThrow("user login or a partner email");
  });

  it("caches the Odoo key, drops it on 401 and on a config change", async () => {
    await link();
    await plugin.definition.onConfigChanged!(config, {} as never);
    resolved = [];
    await h.performAction("list", { issueId }, user);
    await h.performAction("list", { issueId }, user);
    expect(resolved).toEqual(["gw"]);
    reply = () => ({ status: 401, json: { message: "Invalid apikey" } });
    await expect(h.performAction("list", { issueId }, user)).rejects.toThrow("HTTP 401");
    reply = () => ({ json: { status: "OK", files: [] } });
    await h.performAction("list", { issueId }, user);
    expect(resolved).toEqual(["gw", "gw"]);
    await plugin.definition.onConfigChanged!(config, {} as never);
    await h.performAction("list", { issueId }, user);
    expect(resolved).toEqual(["gw", "gw", "gw"]);
  });

  it("asks an agent: assigns the task, and the person's comment names the file", async () => {
    await link();
    await h.performAction("ask", { issueId, agentId, fileId: 7, name: "a.xlsx", version: 3, versionId: 30, request: "add a total row" }, user);
    expect(await h.ctx.issues.get(issueId, companyId)).toMatchObject({ assigneeAgentId: agentId, status: "todo" });
    const [c] = await comments();
    expect(c).toMatchObject({ authorType: "user", authorUserId: "u1" });
    expect(c.body).toContain("@Ratchet add a total row");
    expect(c.body).toContain("Odoo file 7, v3, version_id 30");
  });
});

describe("agent tools", () => {
  it("use the agent's own key, never as_login, and return LOCKED as a result", async () => {
    await link();
    reply = () => ({ json: { status: "LOCKED", editors: [{ id: 2, name: "Alice" }], since: "2026-10-27T10:00:00", reason: "editor" } });
    const r = await h.executeTool("doc_write", { fileId: 7, contentB64: "aGk=", baseVersionId: 3 }, run);
    expect(r).toMatchObject({ data: { status: "LOCKED" } });
    expect(r.error).toBeUndefined();
    expect(calls[0]).toMatchObject({ url: "https://odoo.test/json/2/dms.file/agent_write", auth: "bearer key-ratchet",
      body: { ids: [7], content_b64: "aGk=", base_version_id: 3, note: "" } });

    await h.executeTool("doc_list", { issueId }, run);
    expect(calls[1].body).toEqual({ res_model: "project.task", res_id: 42, query: null });
  });

  it("refuse agents without a key and tasks without a link", async () => {
    expect(await h.executeTool("doc_read", { fileId: 7 }, { ...run, agentId: "44444444-4444-4444-8444-444444444444" }))
      .toEqual({ error: "This agent has no Odoo user (no key in agentKeys)" });
    expect((await h.executeTool("doc_list", { issueId }, run)).error).toMatch(/not linked/);
    expect(calls).toEqual([]);
  });

  it("post a save line as the agent with the note and an Open link", async () => {
    await link();
    reply = (m) => ({ json: m === "agent_write" ? { status: "OK", version_id: 31, version: 4 } : { status: "OK", files: [{ id: 7, name: "a.xlsx" }] } });
    await h.executeTool("doc_write", { fileId: 7, contentB64: "aGk=", baseVersionId: 30, note: "total row", issueId }, run);
    const [c] = await comments();
    expect(c).toMatchObject({ authorType: "agent", authorAgentId: agentId,
      body: "Saved **a.xlsx** v4 in Odoo: total row · [Open](https://odoo.test/shellkube_dms/oo/editor/7)" });
  });
});

describe("diagrams", () => {
  it("create from Mermaid, open in Odoo from the save line, no thumbnails in doc_list", async () => {
    await link();
    const url = "https://odoo.test/odoo/action-shellkube_dms_excalidraw.open?file_id=8";
    reply = (m) => ({ json: m === "agent_create" ? { status: "OK", id: 8, version_id: 80, version: 1 }
      : { status: "OK", files: [{ id: 8, name: "Flow.excalidraw", odoo_url: url, thumbnail_b64: "iVBOR" }] } });
    await h.executeTool("doc_create", { issueId, name: "Flow.excalidraw", mermaid: "graph TD; A-->B", note: "process" }, run);
    expect(calls[0].body).toEqual({ res_model: "project.task", res_id: 42, name: "Flow.excalidraw", content_b64: null,
      mermaid: "graph TD; A-->B", note: "process" });
    expect((await comments())[0].body).toBe(`Saved **Flow.excalidraw** v1 in Odoo: process · [Open](${url})`);
    const listed = await h.executeTool("doc_list", { issueId }, run);
    expect(listed.data).toEqual({ status: "OK", files: [{ id: 8, name: "Flow.excalidraw", odoo_url: url }] });
  });
});

describe("Knowledge tools", () => {
  it("call document.page with the agent's key and pick the write mode from the arguments", async () => {
    reply = () => ({ json: { status: "OK" } });
    await h.executeTool("kb_search", { query: "pricing" }, run);
    await h.executeTool("kb_read", { pageId: 9 }, run);
    await h.executeTool("kb_write", { pageId: 9, markdown: "more", baseHistoryId: 5 }, run);
    await h.executeTool("kb_write", { pageId: 9, markdown: "## Steps\n\n- two", baseHistoryId: 5, section: "Steps", summary: "steps" }, run);
    await h.executeTool("kb_write", { markdown: "# New", parentId: 3 }, run);
    expect(calls.every((c) => c.auth === "bearer key-ratchet")).toBe(true);
    expect(calls.map((c) => [c.url.replace("https://odoo.test/json/2/", ""), c.body])).toEqual([
      ["document.page/kb_search", { query: "pricing", limit: 20 }],
      ["document.page/kb_read", { ids: [9] }],
      ["document.page/kb_write", { ids: [9], md: "more", mode: "append", section: null, base_history_id: 5, summary: "" }],
      ["document.page/kb_write", { ids: [9], md: "## Steps\n\n- two", mode: "replace_section", section: "Steps", base_history_id: 5, summary: "steps" }],
      ["document.page/kb_write", { md: "# New", mode: "create", name: null, parent_id: 3, summary: "" }],
    ]);
    expect((await h.executeTool("kb_write", { pageId: 9, markdown: "x" }, run)).error).toMatch(/baseHistoryId/);
  });

  it("return CONFLICT as a result and post a save line only for OK", async () => {
    reply = () => ({ json: { status: "CONFLICT", current_history_id: 6 } });
    expect(await h.executeTool("kb_write", { pageId: 9, markdown: "x", baseHistoryId: 5, issueId }, run))
      .toMatchObject({ data: { status: "CONFLICT", current_history_id: 6 } });
    expect(await comments()).toEqual([]);
    reply = () => ({ json: { status: "OK", name: "Pricing", state: "to approve", odoo_url: "https://odoo.test/odoo/knowledge/9" } });
    await h.executeTool("kb_write", { pageId: 9, markdown: "x", baseHistoryId: 5, summary: "new prices", issueId }, run);
    expect((await comments())[0]).toMatchObject({ authorAgentId: agentId,
      body: "Saved Knowledge page **Pricing** (waits for approval): new prices · [Open](https://odoo.test/odoo/knowledge/9)" });
  });
});

describe("Odoo webhook", () => {
  it("pushes to the task's Files tab and rejects a bad signature", async () => {
    await link();
    const emit = vi.spyOn(h.ctx.streams, "emit");
    await webhook({ event: "version", file_id: 7, version: 4, author_name: "Alice", editors: [] });
    expect(emit).toHaveBeenCalledWith(`files:${issueId}`, { event: "version", fileId: 7 });
    await expect(webhook({ event: "version", file_id: 7 }, "wrong")).rejects.toThrow("bad signature");
    expect(emit).toHaveBeenCalledTimes(1);
  });

  it("wakes an agent that got LOCKED once the file is free, and only once", async () => {
    await link();
    await h.ctx.issues.update(issueId, { assigneeAgentId: agentId, status: "in_progress" }, companyId);
    reply = () => ({ json: { status: "LOCKED", editors: [{ id: 2, name: "Alice" }] } });
    await h.executeTool("doc_write", { fileId: 7, contentB64: "aGk=", baseVersionId: 3, issueId }, run);
    const wake = vi.spyOn(h.ctx.issues, "requestWakeup");

    await webhook({ event: "version", file_id: 7, version: 4, author_name: "Alice", editors: [{ id: 2, name: "Alice" }] }); // force-save, still open
    expect(wake).not.toHaveBeenCalled();
    await webhook({ event: "unlocked", file_id: 7, name: "a.xlsx", version: 5, author_name: "Alice", editors: [] });
    await webhook({ event: "unlocked", file_id: 7, name: "a.xlsx", version: 5, author_name: "Alice", editors: [] });
    expect(wake).toHaveBeenCalledTimes(1);
    const all = await comments();
    expect(all).toHaveLength(1);
    expect(all[0].body).toContain("@Ratchet **a.xlsx** is free again: v5 by Alice");
  });
});
