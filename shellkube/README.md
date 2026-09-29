# Shellkube fork of Paperclip

Fork: github.com/KubeAl/paperclip · Upstream: github.com/paperclipai/paperclip (default branch `master`)
Runs the Mac instance `~/.paperclip/instances/default` (same embedded Postgres, port 54329) via LaunchAgent `ing.paperclip.paperclipai`.

## Branches
- `master` — pure mirror of upstream/master. Never commit here. Fast-forward only.
- `shellkube` — what we run. = master + our commits. Updated by MERGING master (no rebase, no force-push).

## Where our changes go (keep upstream merges conflict-free)
1. **Adapters/features as external plugins** → `shellkube/adapters/<name>/` (own package, loaded by Paperclip's
   external adapter plugin loader; see docs/adapters/external-adapters.md). No core edits needed.
2. Anything else → `shellkube/` (scripts, docs, config).
3. Core patches only when unavoidable: small, one topic per commit, message prefix `[shellkube]`,
   listed in the table below. Prefer sending them upstream as PRs.

| Core patch | Files | Upstream PR |
|---|---|---|
| (none yet) | | |

## Update from upstream
`shellkube/scripts/sync-upstream.sh` — fetch → ff master → push master → merge into shellkube (stops on conflict).
Then `shellkube/scripts/deploy.sh`.

## How it runs
LaunchAgent (copy in `shellkube/launchd/`): `node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts run --instance default`
= upstream's `pnpm paperclipai run` (the bundled `cli/dist` needs npm-release deps, don't use it).
`PAPERCLIP_UI_DEV_MIDDLEWARE=false` → serves the built `ui/dist` instead of Vite dev mode. `PATH` includes /opt/homebrew/bin, ~/.local/bin, ~/.npm-global/bin (claude, prime-agent, ocr, git 2.55).
HTTPS: `tailscale serve --https=3443 → 127.0.0.1:3100`.

## Deploy / rollback
`shellkube/scripts/deploy.sh` — DB backup → pnpm install → build → restart LaunchAgent → health check.
Rollback: `git switch -d <previous sha>` + deploy.sh; if a migration broke the DB, restore the backup it printed.
Last resort: point the LaunchAgent back at the npm CLI (`~/infra/paperclip/ing.paperclip.paperclipai.plist.bak-npm`).
Note: upstream migrations only go forward — an older build cannot run on a newer DB without restoring a backup.
