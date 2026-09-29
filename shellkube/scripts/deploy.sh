#!/bin/bash
# Build the checked-out fork and restart the LaunchAgent. Backs up the DB first.
set -euo pipefail
SRC="$(cd "$(dirname "$0")/../.." && pwd)"
CFG="$HOME/.paperclip/instances/default/config.json"
BK="$HOME/infra/paperclip/backups"
LABEL=ing.paperclip.paperclipai
cd "$SRC"
PCLI=(node cli/node_modules/tsx/dist/cli.mjs cli/src/index.ts)   # same entrypoint the LaunchAgent uses
echo "== backup"; "${PCLI[@]}" db:backup -c "$CFG" --dir "$BK" --filename-prefix pre-deploy --retention-days 60 --json | grep backupFile
echo "== install"; pnpm install --no-frozen-lockfile > /tmp/pc-install.log 2>&1 || { tail -20 /tmp/pc-install.log; exit 1; }
git checkout -q -- pnpm-lock.yaml 2>/dev/null || true
echo "== build";   pnpm build > /tmp/pc-build.log 2>&1 || { tail -30 /tmp/pc-build.log; exit 1; }
echo "== plugins"; for p in shellkube/plugins/*/build.mjs; do node "$p"; done   # installed from these paths; dist is gitignored
echo "== restart"; launchctl kickstart -k "gui/$(id -u)/$LABEL"
for i in $(seq 1 40); do curl -sf -m3 -o /dev/null http://127.0.0.1:3100/api/health && { echo "healthy: $(git log -1 --format='%h %s')"; exit 0; }; sleep 3; done
echo "NOT healthy — see ~/.paperclip/instances/default/logs/service.err.log"; exit 1
