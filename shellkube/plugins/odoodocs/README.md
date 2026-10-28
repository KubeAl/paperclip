# shellkube-odoodocs (Paperclip plugin)

Files of an Odoo `project.task` on a Paperclip task, edited in ONLYOFFICE. Plugin key `shellkube.odoodocs`.
Interface: `kubo19-docs/docs/shellkube_documents/CONTRACT.md` (Odoo JSON-2 methods on `dms.file`).

- **Config** (per company, `POST /api/plugins/<id>/config`): `odooUrl`, `odooDb`, `docsUrl`, `gatewayKey`,
  `agentKeys {<paperclip agent id>: secret_ref}` and `webhookSecret`. Keys are company secrets (`{type:"secret_ref", secretId}`),
  never plain. The worker caches resolved keys in memory for 10 min (host limit: 30 lookups/min/company); a 401 or a
  config save drops them.
- **Link**: entity `odoo-task` per issue, `externalId = <db>:project.task:<id>`, `data {model, taskId, companyId}`, status
  `linked`/`unlinked` (no delete in the SDK). One linked task per issue. Needs carried patch "entities.list scope filter".
- **Files tab** (`detailTab` "Odoo files", opens by itself once per browser session on a linked task): link/unlink, Open task
  in Odoo, list with `author_name`, New (blank .docx/.xlsx/.pptx or a template), Upload, Request a file, and per file
  Open / New tab / Versions / PDF / Share / Ask an agent / Odoo. Open is a modal that frames the New-tab page
  (`dist/ui/editor/index.html`), so every open gets a fresh api.js. All person calls are **actions**: the worker passes
  the host-verified `actor.userEmail` as `as_login` with the gateway key, so Odoo checks access as that person.
- **Live updates**: Odoo posts file events to `POST /api/plugins/<id>/webhooks/odoo` (header `X-Shellkube-Signature:
  sha256=<hmac of raw body>`). The worker finds the issues linked to that task, checks the HMAC with each company's
  `webhookSecret`, and emits on stream `files:<issueId>`; open tabs reload the list (↻ stays as a manual refresh).
- **Ask an agent**: assigns the issue to the agent (backlog/done/cancelled -> todo) and posts the person's comment
  `@Agent <request>` naming the file id, version and version_id; that comment wakes the agent.
- **Lock waits**: a `doc_write` with `issueId` that returns LOCKED records the agent (issue state `lock-waits`). An
  `unlocked` event (or `version` with no editors left) posts one comment "<file> is free again: vN by <person>" and wakes
  the agent (`requestWakeup` if it is the assignee, else `agents.invoke`).
- **Save lines**: `doc_write`/`doc_create` with `issueId` post "Saved **<name>** vN in Odoo: <note> · Open" as the agent
  (agent comments wake nobody).
- **Agent tools** (allowed by tool policy "Odoo docs tools for agents"): `doc_list, doc_read, doc_write, doc_create,
  doc_comment, doc_templates, doc_export_pdf, doc_share, doc_request` with the calling agent's own key (no `as_login`).
  LOCKED/CONFLICT come back as results.
- **Knowledge tools**: `kb_search, kb_read, kb_write` call `document.page` (Odoo module `document_page_agent`) with the
  agent's key: pages as markdown, `kb_write` appends, replaces one section (`section`) or creates (no `pageId`), with
  `baseHistoryId` and OK/LOCKED/CONFLICT. Changes go through the page's approval (`state: to approve`). With `issueId`
  an OK posts "Saved Knowledge page **<name>**: <summary> · Open". Add them to the agents' tool policy to allow them.
- **CLI for agents**: `~/infra/paperclip/bin/odoo-docs` (symlink to `bin/odoo-docs`). Managed skill `odoo-docs` (`SKILL.md`),
  installed into the company skill library when the config is saved.
- The live panel's "Save to Odoo task" calls the `write`/`create` actions here (see livepanel README).

## Build / test / install
```
node shellkube/plugins/odoodocs/build.mjs
cd shellkube/plugins/odoodocs && ../../../node_modules/.bin/vitest run --config vitest.config.ts && pnpm typecheck
POST /api/plugins/install {"packageName": "<abs path of this dir>", "isLocalPath": true}   # once
```
After a rebuild: disable + enable the plugin (or restart Paperclip; a restart also picks up manifest changes).
