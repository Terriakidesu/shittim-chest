#!/usr/bin/env bash
# Publish dist/ to the gh-pages branch for branch-based GitHub Pages hosting.
#
# Uses no GitHub Actions: the build and push happen wherever this script runs
# (your machine, a local weekly cron, ...). Run gh-pages branch publishing
# once via Settings or the API; afterwards every run just updates the branch.
#
# Usage: bash scripts/deploy-branch.sh
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bun run build

TMP="$(mktemp -d)"
cleanup() { git worktree remove --force "$TMP/site" 2>/dev/null || true; rm -rf "$TMP"; }
trap cleanup EXIT

if git show-ref --verify --quiet refs/heads/gh-pages; then
  git worktree add -q "$TMP/site" gh-pages
else
  git worktree add -q --detach "$TMP/site" main
  git -C "$TMP/site" checkout -q --orphan gh-pages
  git -C "$TMP/site" rm -qrf . || true
fi

# Replace the branch contents with the fresh build (the .git pointer stays).
find "$TMP/site" -mindepth 1 -maxdepth 1 ! -name '.git' -exec rm -rf {} +
cp -r "$ROOT/dist/." "$TMP/site/"
git -C "$TMP/site" add -A
if git -C "$TMP/site" diff --quiet --cached; then
  echo "gh-pages is already up to date."
else
  git -C "$TMP/site" commit -q -m "deploy: static build $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  git -C "$TMP/site" push origin gh-pages
fi
