# shellkube-odoodocs (Paperclip plugin)

Files of an Odoo `project.task` on a Paperclip task, edited in ONLYOFFICE. Plugin key `shellkube.odoodocs`.
Interface: `kubo19-docs/docs/shellkube_documents/CONTRACT.md` (Odoo JSON-2 methods on `dms.file`).

- **Config** (per company, `POST /api/plugins/<id>/config`): `odooUrl`, `odooDb`, `docsUrl`, `gatewayKey` and
  `agentKeys {<paperclip agent id>: secret_ref}`. Keys are company secrets (`{type:"secret_ref", secretId}`), never plain.
- **Link**: entity `odoo-task` per issue, `externalId = <db>:project.task:<id>`, status `linked`/`unlinked` (no delete in the SDK).
  One linked task per issue.
- **Files tab** (`detailTab` "Files"): link/unlink by task id, list (polls every 30 s), upload, versions, Open (full-screen
  modal) and New tab (`dist/ui/editor/index.html`, a plain same-origin page). All person calls are **actions**: they carry
  the host-verified actor, and the worker passes `actor.userEmail` (host change H1) as `as_login` with the gateway key,
  so Odoo checks access as that person. The editor config comes signed from Odoo; the plugin never holds the Docs JWT secret.
- **Agent tools** (allowed by tool policy "Odoo docs tools for agents"): `doc_list, doc_read, doc_write, doc_create,
  doc_comment` with the calling agent's own key from `agentKeys` (no `as_login`). LOCKED/CONFLICT come back as results.
- **CLI for agents**: `~/infra/paperclip/bin/odoo-docs` (symlink to `bin/odoo-docs`). Managed skill `odoo-docs` (`SKILL.md`),
  installed into the company skill library when the config is saved.

## Build / test / install
```
node shellkube/plugins/odoodocs/build.mjs
cd shellkube/plugins/odoodocs && ../../../node_modules/.bin/vitest run --config vitest.config.ts
POST /api/plugins/install {"packageName": "<abs path of this dir>", "isLocalPath": true}   # once
```
After a rebuild: disable + enable the plugin (or restart Paperclip). Needs the SDK built with H1 (`pnpm --filter @paperclipai/plugin-sdk build`).
