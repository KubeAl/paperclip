# shellkube-planner (Paperclip plugin)

No core patches. Plugin key `shellkube.planner`, DB schema `plugin_planner_8a0184621c`.

- **Calendar** page (sidebar): due / start dates of tasks, routine runs expanded from cron (shown in IST), overdue list, pending tasks without a date.
- **Bookmarks** page (sidebar): links with tag + note, stored per company.
- **Schedule** panel on every task: due date, start-on date.
- **Auto-start** job (every 15 min): backlog task whose start-on date has arrived → `todo` (wakes the assignee). Toggle per company via plugin config `autoStart`.
- **Due soon** dashboard widget.

Limits: dates live in the plugin table, so the core Issues list cannot sort/filter by them. Routines stay the tool for recurring work.

## Build / install
```
node shellkube/plugins/planner/build.mjs          # uses the fork's esbuild + plugin SDK (build the SDK first: pnpm build)
paperclipai plugin install shellkube/plugins/planner   # once; loads from this path
paperclipai plugin config:set shellkube.planner -C <companyId> --payload-json '{"configJson":{"autoStart":true}}'  # required: gives the job company scope
```
After a rebuild: `paperclipai plugin disable shellkube.planner && paperclipai plugin enable shellkube.planner` (deploy.sh rebuilds + restarts).

## Gotchas
- `ctx.db.execute` guard treats any `FROM|JOIN <x>.<y>` as a table ref — avoid `IS DISTINCT FROM EXCLUDED.col`.
- `ctx.db.query` expands array params into a list — don't use `= ANY($n::text[])`.
- Jobs have no company context; host allows only companies with saved plugin config.
