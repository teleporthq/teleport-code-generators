#!/usr/bin/env bash
# Mirrors locally-changed generator packages into the GUI's node_modules —
# the low-tech alternative to npm link (which has been finicky here).
#
#   ./scripts/sync-dists-to-gui.sh [path-to-teleport-gui]
#
# 1. Finds packages with modified/untracked files under packages/*/src (git).
# 2. Builds them (plus their dependency tree, so stale sibling dists can't
#    poison the build) via lerna.
# 3. rsyncs each changed package's dist/ over the GUI's installed copy.
#
# Copies ONLY packages git says changed — dependencies are built for
# correctness but the GUI keeps its installed dists for them. Note the copy
# carries EVERYTHING your repo's branch has over the installed version, not
# just your working-tree edits; that is usually what "test the pushable
# state" means. Re-run `npm install` in the GUI to restore pristine packages.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
GUI_ROOT="${1:-$REPO_ROOT/../teleport-gui}"
GUI_SCOPE_DIR="$GUI_ROOT/node_modules/@teleporthq"

if [ ! -d "$GUI_SCOPE_DIR" ]; then
  echo "error: $GUI_SCOPE_DIR not found — pass the teleport-gui path as the first argument" >&2
  exit 1
fi

cd "$REPO_ROOT"

changed_packages="$(
  {
    git diff --name-only HEAD
    git ls-files --others --exclude-standard
  } |
    sed -n 's|^packages/\([^/]*\)/src/.*|\1|p' |
    sort -u
)"

if [ -z "$changed_packages" ]; then
  echo "No packages with src changes — nothing to sync."
  exit 0
fi

echo "Changed packages:"
echo "$changed_packages" | sed 's/^/  - /'

scope_flags=""
for package_name in $changed_packages; do
  scope_flags="$scope_flags --scope @teleporthq/$package_name"
done

echo
echo "Building (with dependencies)..."
# shellcheck disable=SC2086
npx lerna run build $scope_flags --include-dependencies

echo
for package_name in $changed_packages; do
  source_dist="$REPO_ROOT/packages/$package_name/dist"
  target_dist="$GUI_SCOPE_DIR/$package_name/dist"
  if [ ! -d "$GUI_SCOPE_DIR/$package_name" ]; then
    echo "skip  $package_name (not installed in the GUI)"
    continue
  fi
  if [ ! -d "$source_dist" ]; then
    echo "skip  $package_name (no dist/ after build?)" >&2
    continue
  fi
  rsync -a --delete "$source_dist/" "$target_dist/"
  echo "sync  $package_name  ->  $target_dist"
done

# Next's webpack persistent cache keys node_modules by package VERSION
# (managedPaths), which rsyncing dists never bumps — so even a dev-server
# RESTART keeps serving the old compiled modules. Purge the cache so the next
# start recompiles from the synced dists (cost: one slower cold start).
webpack_cache_dir="$GUI_ROOT/apps/gui/.next/cache/webpack"
if [ -d "$webpack_cache_dir" ]; then
  rm -rf "$webpack_cache_dir"
  echo "purged $webpack_cache_dir (stale-dist trap)"
fi

echo
echo "Done. Restart the GUI dev server so webpack picks the new dists up."
