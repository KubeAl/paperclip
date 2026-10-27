# shellkube-livepanel (Paperclip plugin)

Agents show live HTML on a task or agent chat (progress, forms, tables, previews) and get the user's input back.
Plugin key `shellkube.livepanel`. Needs the carried stream-bus patch (upstream PR #8150) for live push.

- **Tools** (allowed for agents by tool policy "Live panel tools for agents"): `live_render` (whole page; empty html
  removes the panel), `live_patch` (ops on CSS selectors: inner/outer/append/prepend/text/remove, and/or a shallow
  `data` merge), `live_input` (submits after `after`, optional `waitSeconds` <= 25).
- **CLI for agents**: `~/infra/paperclip/bin/live-panel` (symlink to `bin/live-panel` here) wraps the tools with the run's env.
- **Panel**: a `taskDetailView` slot, so it shows on task pages and in Agent Chat. Hidden when the task has no panel.
- **Frame**: agent HTML runs in `<iframe sandbox="allow-scripts">` (opaque origin, never `allow-same-origin`) with a
  CSP that blocks all network, forms and frames. The host posts render/patch/data messages; the frame morphs the body
  so typed input and scroll survive updates. Its only way out: `paperclip.submit()`, `<form>` submit, `[data-submit]`
  buttons, and http(s) link clicks (opened in a new tab by the host).
- **Submit**: stored on the panel (last 50). If the form wakes (default), the plugin posts the values as a comment
  attributed to the user, which wakes the assignee like any user comment. `data-wake="false"` only stores.
- **Sheet** (`live_render` with `sheet`, CLI `live-panel sheet FILE.xlsx|.csv|.json`): a spreadsheet computed in the browser
  by HyperFormula 3.5 (GPL-3 key `gpl-v3`; fine for this internal, undistributed fork plugin). The worker builds it once to
  return cells that show errors (#NAME?, #REF!, ...). Users edit through the formula bar (Enter/Tab/arrows); dependents
  recalc at once. Save stores the sheet (no wake); Send also posts a changed-cells table as the user. `live_input` returns
  `{changes, sheets (formulas), values}`. Saved sheets come back after a reload until the next render. The CLI reads
  .xlsx with the stdlib: formulas and values only (no formats/styles/charts; dates are serial numbers; Excel shared
  formulas keep their stored value). No export back to .xlsx.
- **Sheet, o-spreadsheet engine** (`--engine owl`, panel field `engine:"owl"`): the same sheet in Odoo's o-spreadsheet 19.0
  (LGPL; Owl + Bootstrap) inside an opaque-origin frame (`dist/ui/owl/`, one hashed .js/.css, served immutable). With an
  .xlsx the CLI also sends the unzipped XML (`xlsx`, max 4 MB), so formats, styles, merges and charts show. `owl_xlsx()` fixes
  what 19.0 cannot read in openpyxl files (absolute rel targets, inline strings, alpha-00 colours, unprefixed drawing/chart
  tags). Images are skipped; only Arial is supported. Same Save/Send and `live_input` shape, plus `owl` (the full
  o-spreadsheet export, kept only on the newest input) to restore edits after reload.
  **Save to Odoo task** (shown when the task is linked in the odoodocs "Odoo files" tab): the frame builds the .xlsx and the
  UI calls odoodocs' `write`/`create` actions as the signed-in person (`/api/plugins/shellkube.odoodocs/actions/...`, no
  second Odoo client). With `--odoo-file ID --odoo-base VERSION_ID` (panel `data.odoo`) it saves a new version of that file,
  else a new `<title>.xlsx` on the task; the new base goes into the panel's saved input, so later saves build on it.
  A newer Odoo version gives "Not saved: version N was saved in Odoo after this sheet was loaded".
- **OpenUI** (`live_render` with `openui`, CLI `live-panel ui FILE.oui`, agent doc `live-panel-ui.md`): an OpenUI Lang program
  (@openuidev/react-lang 1.0.1 + react-ui 0.18.1, MIT) for charts and rich choice cards. The worker parses it with lang-core
  against the library's JSON schema (build.mjs writes `dist/openui-schema.json`) and rejects errors, undefined or unused names
  and Query/Mutation. Rendered in an opaque-origin frame (`dist/ui/openui/`, React bundled in, one hashed .js/.css, CSP blocks
  network). Library = `openuiLibrary` minus CodeBlock; the syntax highlighter and katex are stubbed at build (markdown code is
  plain, math shows as source). `@ToAssistant` buttons submit `{action, values: form fields + context}` (wakes); `@OpenUrl` opens
  http(s) in a new tab. Theme is taken from the host on load. Typed values are not restored after a reload.
  Deps were installed with `OPENUI_TELEMETRY_DISABLED=1` (lang-core's postinstall pings PostHog otherwise).
- **Storage**: plugin state, scope issue, key `panels`. Limits: 8 panels per task, 256 KB html, 300 patches per render.

## Page API (inside the frame)
- `<form data-action="x" [data-wake="false"]>`; submit buttons may carry their own `data-action`.
- `<form data-save>`: each change is stored at once (no wake). Values stored since the agent's last render are put back into
  the form on load (latest per action), so checklists keep their ticks across reloads.
- `<button data-submit="approve" data-values='{"id":3}'>` outside forms.
- `data-bind="a.b"` elements show `data.a.b` (progress/meter get `.value`); `paperclip.onData(cb)`, `paperclip.data`.
- Scripts run on insert; there is no second `DOMContentLoaded`, so put scripts at the end of the body.
- Built-in classes: `row spacer card muted`, `tiles > tile[.ok|.warn|.err|.info] > .v + .l`, `pill[.ok|.warn|.err|.info]`,
  `list > label.item > input + .main(.t, .sub) + pill` (checked rows strike through), `kv`, `td.num`, `details`. Example in Bumble Bee's AGENTS.md.

## Build / install
```
node shellkube/plugins/livepanel/build.mjs     # deploy.sh builds every plugin
POST /api/plugins/install {"packageName": "<abs path of this dir>", "isLocalPath": true}   # once
```
After a rebuild: disable + enable the plugin (or restart Paperclip).
