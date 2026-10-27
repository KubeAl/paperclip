import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestHarness, type TestHarness } from "@paperclipai/plugin-sdk/testing";
import manifest from "../src/manifest";
import plugin from "../src/worker";

const companyId = "11111111-1111-4111-8111-111111111111";
const issueId = "22222222-2222-4222-8222-222222222222";
const agentId = "33333333-3333-4333-8333-333333333333";
const ref = (secretId: string) => ({ type: "secret_ref", secretId });
const config = { odooUrl: "https://odoo.test", odooDb: "demo19", docsUrl: "https://docs.test",
  gatewayKey: ref("gw"), agentKeys: { [agentId]: ref("ratchet") } };
const user = { actor: { type: "user" as const, userId: "u1", userEmail: "alice@example.com", companyId }, companyId };
const run = { agentId, companyId, runId: "r1", projectId: "p1" };

let h: TestHarness;
let calls: Array<{ url: string; auth: string; db: string; body: Record<string, unknown> }>;
let reply: (method: string) => { status?: number; json: unknown };

beforeEach(async () => {
  h = createTestHarness({ manifest, config });
  h.seed({ issues: [{ id: issueId, companyId } as never] });
  h.ctx.secrets.resolve = async (r) => `key-${(r as { secretId: string }).secretId}`;
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

  it("asks for the editor config as the user", async () => {
    await h.performAction("editor-config", { fileId: 7 }, user);
    expect(calls[0].body).toEqual({ ids: [7], mode: "edit", as_login: "alice@example.com" });
  });
});

describe("agent tools", () => {
  it("use the agent's own key, never as_login, and return LOCKED as a result", async () => {
    await h.performAction("link", { issueId, taskId: 42 }, user);
    calls = [];
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
});
