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
- **Storage**: plugin state, scope issue, key `panels`. Limits: 8 panels per task, 256 KB html, 300 patches per render.

## Page API (inside the frame)
- `<form data-action="x" [data-wake="false"]>`; submit buttons may carry their own `data-action`.
- `<button data-submit="approve" data-values='{"id":3}'>` outside forms.
- `data-bind="a.b"` elements show `data.a.b` (progress/meter get `.value`); `paperclip.onData(cb)`, `paperclip.data`.
- Scripts run on insert; there is no second `DOMContentLoaded`, so put scripts at the end of the body.
- Built-in classes: `card row muted ok warn err badge primary`.

## Build / install
```
node shellkube/plugins/livepanel/build.mjs     # deploy.sh builds every plugin
POST /api/plugins/install {"packageName": "<abs path of this dir>", "isLocalPath": true}   # once
```
After a rebuild: disable + enable the plugin (or restart Paperclip).
