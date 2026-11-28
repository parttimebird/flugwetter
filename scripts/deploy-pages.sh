#!/usr/bin/env bash
# Baut die Handy-App und legt die Web-Fassung auf den Branch gh-pages, aus dem GitHub Pages die Seite ausliefert.
#
#   bash scripts/deploy-pages.sh            Live-Fassung ins Wurzelverzeichnis (…/flugwetter/)
#   bash scripts/deploy-pages.sh vorschau   Vorschau-Fassung nach …/flugwetter/vorschau/, die Live-Fassung bleibt unverändert
#
# Voraussetzung: Remote "origin" zeigt auf das GitHub-Repository, und unter Settings → Pages ist
# "Deploy from a branch" mit gh-pages / (root) eingestellt.
set -euo pipefail

target="${1:-}"
case "$target" in
  "" | vorschau) ;;
  *) echo "Unbekanntes Ziel: $target (erlaubt: nichts oder vorschau)" >&2; exit 1 ;;
esac

root="$(cd "$(dirname "$0")/.." && pwd)"
cd "$root"
APP_VARIANT="$target" npm run build

remote="$(git remote get-url origin)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

if git ls-remote --exit-code --heads "$remote" gh-pages >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch gh-pages "$remote" "$work"
else
  git -C "$work" init --quiet --initial-branch gh-pages
  git -C "$work" remote add origin "$remote"
fi

if [ -z "$target" ]; then
  # Alten Stand bis auf .git und den Vorschau-Ordner leeren, dann die Web-Fassung hineinkopieren.
  find "$work" -mindepth 1 -maxdepth 1 ! -name .git ! -name vorschau -exec rm -rf {} +
  cp -r dist/. "$work"/
  rm -f "$work/artifact.html"
  what="Live-Fassung"
else
  # Nur den Unterordner ersetzen, alles andere bleibt, wie es ist.
  rm -rf "${work:?}/$target"
  mkdir -p "$work/$target"
  cp -r dist/. "$work/$target"/
  rm -f "$work/$target/artifact.html" "$work/$target/.nojekyll"
  what="Vorschau unter /$target/"
fi

git -C "$work" add --all
if git -C "$work" diff --cached --quiet; then
  echo "gh-pages ist schon aktuell."
  exit 0
fi
git -C "$work" commit --quiet -m "$what aus $(git rev-parse --short HEAD 2>/dev/null || echo 'lokalem Stand')"
git -C "$work" push --quiet origin gh-pages
echo "gh-pages aktualisiert ($what). GitHub Pages braucht etwa eine Minute, bis die neue Fassung ausgeliefert wird."
