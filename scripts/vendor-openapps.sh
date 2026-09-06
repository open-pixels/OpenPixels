#!/usr/bin/env bash
# Refresh the vendored OpenApps account UI and design tokens.
#
#   ./scripts/vendor-openapps.sh [path-to-openapps-monorepo]
#
# WHY THESE ARE VENDORED AND NOT A DEPENDENCY
#
# `@openapps/sdk` and `@openapps/ui` are not published to npm, so there is no
# version to depend on. They used to be reached across the monorepo with a
# relative path -- which worked exactly as long as this app lived inside it,
# and broke the moment it became its own repository, because a clone has no
# `../../../tokens` to resolve.
#
# So the build output is copied in. That is a real cost -- a copy drifts from
# its source, and only this script closes the gap -- and it buys the thing
# that matters more: a clone of this repository builds with nothing but npm.
#
# WHAT IS COPIED, AND WHAT IS DELIBERATELY NOT
#
#   ui-elements/dist/bundle/*.js  the account components, self-contained
#                                 (lit and the SDK are bundled in)
#   tokens/tokens.css + css/      the CSS custom properties they style from
#   tokens/fonts/*.woff2          the three faces this app renders
#
# Not the source maps: they are twice the size of the code and nobody debugs
# a vendored bundle from here. Not `tokens/css/fonts.css`: it declares every
# Geist cut, and `src/fonts.css` already declares the three this app uses.
# Not `tokens/styles.css`: it restyles `body`, `a` and the headings, which
# would redesign this app around the account panel.
set -euo pipefail

SRC="${1:-../..}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
DEST="$HERE/apps/web/src/vendor/openapps"

for required in "$SRC/ui-elements/dist/bundle" "$SRC/tokens/tokens.css"; do
  if [ ! -e "$required" ]; then
    echo "missing $required" >&2
    echo "Pass the path to the openapps monorepo, and build it first:" >&2
    echo "  (cd \"$SRC/ui-elements\" && npm run build)" >&2
    exit 1
  fi
done

mkdir -p "$DEST/css" "$DEST/fonts"
rm -f "$DEST"/*.js "$DEST"/css/*.css "$DEST"/fonts/*.woff2

# The bundle is code-split, so every chunk beside the entry point is needed.
cp "$SRC"/ui-elements/dist/bundle/*.js "$DEST/"
cp "$SRC"/tokens/css/*.css "$DEST/css/"
cp "$SRC"/tokens/fonts/*.woff2 "$DEST/fonts/"
cp "$SRC"/tokens/tokens.css "$DEST/tokens.css"

# Re-apply the one edit: drop the fonts @import, for the reason above. Done
# here rather than by hand so a refresh cannot silently reintroduce it.
python3 - "$DEST/tokens.css" <<'PY'
import sys, pathlib
p = pathlib.Path(sys.argv[1])
s = p.read_text()
s = s.replace('@import url("./css/fonts.css");\n',
'''/* fonts.css deliberately NOT imported -- see scripts/vendor-openapps.sh.
 * It declares every Geist cut; src/fonts.css already declares the three
 * faces this app renders, so importing it would ship them twice. */
''')
p.write_text(s)
PY

echo "vendored into ${DEST#"$HERE"/}"
ls "$DEST" | sed 's/^/  /'
echo
echo "Now rebuild and re-run the account checks:"
echo "  npm --prefix apps/web run build"
echo "  npm --prefix apps/web run test:account"
