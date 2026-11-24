#!/usr/bin/env bash
# Baut die Handy-App und legt die Web-Fassung auf den Branch gh-pages, aus dem GitHub Pages die Seite ausliefert.
#
#   bash scripts/deploy-pages.sh
#
# Voraussetzung: Remote "origin" zeigt auf das GitHub-Repository, und unter Settings → Pages ist
# "Deploy from a branch" mit gh-pages / (root) eingestellt.
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
npm run build

remote="$(git remote get-url origin)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch gh-pages "$remote" "$work"
else
  git -C "$work" init --quiet --initial-branch gh-pages
  git -C "$work" remote add origin "$remote"
fi

# Alten Stand bis auf .git leeren, dann die Web-Fassung hineinkopieren (ohne die Claude-Fassung).
find "$work" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$work"/
rm -f "$work/artifact.html"

git -C "$work" add --all
if git -C "$work" diff --cached --quiet; then
  echo "gh-pages ist schon aktuell."
  exit 0
fi
git -C "$work" commit --quiet -m "App aus $(git rev-parse --short HEAD 2>/dev/null || echo 'lokalem Stand')"
git -C "$work" push --quiet origin gh-pages
echo "gh-pages aktualisiert. GitHub Pages braucht etwa eine Minute, bis die neue Fassung ausgeliefert wird."
