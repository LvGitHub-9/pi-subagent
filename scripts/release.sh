#!/usr/bin/env bash
# Release pi-subagent: verify, bump, tag, push, publish the GitHub Release.
#
#   scripts/release.sh <version>          e.g. scripts/release.sh 0.2.0
#
# The GitHub Release body comes from the matching CHANGELOG.md section, so write
# that section first (the release commit includes it). On a machine where `gh` is
# not on PATH:  GH=/path/to/gh scripts/release.sh 0.2.0
set -euo pipefail

VERSION="${1:-}"
if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
	echo "usage: scripts/release.sh <version>   (x.y.z, e.g. 0.2.0)" >&2
	exit 2
fi

cd "$(dirname "$0")/.."
TAG="v$VERSION"
GH="${GH:-gh}"
command -v "$GH" >/dev/null 2>&1 || {
	echo "gh not found. Install it or pass GH=/path/to/gh" >&2
	exit 2
}

# --- preconditions ----------------------------------------------------------
if [[ -n "$(git status --porcelain)" ]]; then
	echo "working tree is not clean; commit or stash first" >&2
	exit 1
fi
BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "main" ]]; then
	echo "releases are cut from main, currently on '$BRANCH'" >&2
	exit 1
fi
if git rev-parse -q --verify "refs/tags/$TAG" >/dev/null; then
	echo "tag $TAG already exists" >&2
	exit 1
fi
if ! grep -q "^## \[$VERSION\]" CHANGELOG.md; then
	echo "CHANGELOG.md has no '## [$VERSION]' section — write it before releasing" >&2
	exit 1
fi

# --- verify -----------------------------------------------------------------
echo "==> running the test suite"
npm test

# --- bump, commit, tag ------------------------------------------------------
echo "==> bumping package.json to $VERSION"
node -e '
const fs = require("node:fs");
const file = "package.json";
const data = JSON.parse(fs.readFileSync(file, "utf8"));
data.version = process.argv[1];
fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
' "$VERSION"

git add package.json CHANGELOG.md
git commit -m "chore(release): $TAG"
git tag -a "$TAG" -m "$TAG"

# --- push and publish -------------------------------------------------------
echo "==> pushing $BRANCH and $TAG"
git push origin "$BRANCH"
git push origin "$TAG"

NOTES="$(mktemp)"
trap 'rm -f "$NOTES"' EXIT
# Plain string matching on purpose: a regex here needs to escape the literal '[',
# and the escaping is easy to get wrong when the script is written through a shell.
awk -v want="## [$VERSION]" '
	index($0, want) == 1 { capture = 1; next }
	capture && index($0, "## ") == 1 { exit }
	capture { print }
' CHANGELOG.md > "$NOTES"

if [[ ! -s "$NOTES" ]]; then
	echo "could not extract the $VERSION section from CHANGELOG.md" >&2
	exit 1
fi

echo "==> creating the GitHub Release"
"$GH" release create "$TAG" --title "$TAG" --notes-file "$NOTES"

echo
echo "released $TAG"
