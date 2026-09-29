#!/bin/bash
# Update fork from upstream: ff master, then merge into shellkube. Stops on conflict.
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -z "$(git status --porcelain --untracked-files=no -- . ':!pnpm-lock.yaml')" ] || { echo "dirty tree; commit first"; exit 1; }
git fetch -q upstream --tags
git fetch -q origin
git switch -q master
git merge --ff-only upstream/master
git push -q origin master
git switch -q shellkube
git merge --no-edit master || { echo "CONFLICT: resolve, commit, then run deploy.sh"; exit 2; }
git push -q origin shellkube
echo "shellkube now at $(git log -1 --format='%h %s')"
echo "new upstream migrations since last deploy:"; git diff --name-only ORIG_HEAD HEAD -- packages/db/src/migrations | grep '\.sql$' || echo "  none"
