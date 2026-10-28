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
# Copies the changed packages AND every workspace package they depend on.
# A changed package built from this branch may import something its
# dependency gained on the branch too (`PageArrival` in teleport-shared):
# copying it alone leaves the GUI's installed dependency one release behind
# and publishing fails with "Cannot read properties of undefined". Note the
# copy carries EVERYTHING your repo's branch has over the installed version,
# not just your working-tree edits; that is usually what "test the pushable
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
for package_dir in $changed_packages; do
  # Scope by the package.json name: a folder is not always named after its
  # package (teleport-project-plugin-next-revalidate-api publishes
  # @teleporthq/teleport-next-revalidate-api).
  package_name="$(node -p "require(process.argv[1]).name" "$REPO_ROOT/packages/$package_dir/package.json")"
  scope_flags="$scope_flags --scope $package_name"
done

# The packages to copy: the changed ones plus their workspace dependencies,
# so the GUI runs one consistent branch build.
# shellcheck disable=SC2086
packages_json="$(npx lerna list $scope_flags --include-dependencies --json)"
synced_packages="$(
  printf '%s' "$packages_json" |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { for (const p of JSON.parse(s)) console.log(p.name.replace(/^@teleporthq\//, "")) })' |
    sort -u
)"

# The folder of a package, by its name without the scope (see above: the two
# can differ).
package_location() {
  printf '%s' "$packages_json" |
    node -e 'let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => { const p = JSON.parse(s).find((q) => q.name === "@teleporthq/" + process.argv[1]); console.log(p ? p.location : "") })' "$1"
}

# The package builds are incremental (`tsconfig.tsbuildinfo` inside each dist
# folder). A build info that believes a file is already emitted makes tsc skip
# it, so a dist can keep an OLD module beside a NEW one that imports from it —
# the GUI then fails at publish with "X is not a function". Dropping the build
# info of the packages being synced forces a full emit of exactly what is copied.
for package_name in $synced_packages; do
  package_dir="$(package_location "$package_name")"
  rm -f "$package_dir/dist/esm/tsconfig.tsbuildinfo" \
    "$package_dir/dist/cjs/tsconfig.tsbuildinfo"
done

echo
echo "Building (with dependencies)..."
# shellcheck disable=SC2086
npx lerna run build $scope_flags --include-dependencies

# Every installed copy of a @teleporthq package, the top-level one and the
# NESTED ones (node_modules/@teleporthq/<pkg>/node_modules/@teleporthq/<dep>,
# apps/gui/node_modules/@teleporthq/<dep>). Node resolves a nested copy first,
# so a stale one makes the synced code call functions its dependency lacks.
installed_copies="$(
  find "$GUI_ROOT/node_modules" "$GUI_ROOT/apps/gui/node_modules" \
    -type f -name package.json -path '*/node_modules/@teleporthq/*/package.json' 2>/dev/null |
    sed 's|/package.json$||' |
    awk -F/ '$(NF-1) == "@teleporthq"'
)"

echo
for package_name in $synced_packages; do
  source_dist="$(package_location "$package_name")/dist"
  copies="$(printf '%s\n' "$installed_copies" | awk -F/ -v name="$package_name" '$NF == name')"
  if [ -z "$copies" ]; then
    echo "skip  $package_name (not installed in the GUI)"
    continue
  fi
  if [ ! -d "$source_dist" ]; then
    echo "skip  $package_name (no dist/ after build?)" >&2
    continue
  fi
  while IFS= read -r copy; do
    rsync -a --delete "$source_dist/" "$copy/dist/"
    echo "sync  $package_name  ->  $copy/dist"
  done <<< "$copies"
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
