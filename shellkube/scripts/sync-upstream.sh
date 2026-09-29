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
# Carried core patches: revert ours once upstream merged its fix (see shellkube/carried-patches.txt).
CP=shellkube/carried-patches.txt
if [ -f "$CP" ]; then
  while read -r sha prs note; do
    case "$sha" in ''|'#'*) continue;; esac
    for pr in ${prs//,/ }; do
      if [ "$(gh pr view "$pr" --repo paperclipai/paperclip --json state -q .state 2>/dev/null)" = "MERGED" ]; then
        echo "upstream merged #$pr -> reverting carried $sha ($note)"
        git revert --no-edit "$sha" || { echo "CONFLICT reverting $sha: resolve, commit, rerun"; exit 2; }
        grep -v "^$sha " "$CP" > "$CP.tmp" && mv "$CP.tmp" "$CP"
        git commit -q -am "carried-patches: drop $sha (upstream #$pr merged)"
        echo "  RE-TEST: $note"; break
      fi
    done
  done < <(cat "$CP")
fi
git merge --no-edit master || { echo "CONFLICT: resolve, commit, then run deploy.sh"; exit 2; }
git push -q origin shellkube
echo "shellkube now at $(git log -1 --format='%h %s')"
echo "new upstream migrations since last deploy:"; git diff --name-only ORIG_HEAD HEAD -- packages/db/src/migrations | grep '\.sql$' || echo "  none"
