#!/usr/bin/env bash
# Assembles the whole static site into apps/web/dist.
#
# The output is a plain folder of files: any static host serves it, and
# there is no server component to run — which is the same fact the About
# page claims.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
ROOT="$(cd "$WEB_DIR/../.." && pwd)"
DIST="$WEB_DIR/dist"

log() { printf '\033[1m==> %s\033[0m\n' "$1"; }

log "Building the Rust core for wasm32"
bash "$SCRIPT_DIR/build-wasm.sh"

log "Fetching the ONNX weights"
bash "$SCRIPT_DIR/fetch-models.sh"

# Cleared here rather than by Vite: it is configured not to empty the
# directory, because the models and the ONNX runtime are copied in below and
# a bare `vite build` would otherwise delete half a gigabyte it cannot put
# back. This
# is the one place that knows the whole directory is ours.
log "Bundling the app"
rm -rf "$DIST"
(cd "$WEB_DIR" && npx vite build)

[ -f "$DIST/index.html" ] || { echo "build.sh: vite produced no index.html" >&2; exit 1; }

# The ONNX runtime binaries. onnxruntime-web resolves these at run time from
# `ort.env.wasm.wasmPaths` (src/lib/engine/ort.js), so no bundler ever sees
# them and nothing copies them unless this does.
#
# Both are shipped and exactly one is fetched per visitor: the app picks the
# WebGPU build when the browser has WebGPU and the CPU build when it does
# not. That costs disk on the server, not bandwidth for the user.
log "Copying the ONNX runtime"
mkdir -p "$DIST/ort"
ORT_DIST="$WEB_DIR/node_modules/onnxruntime-web/dist"
[ -d "$ORT_DIST" ] || { echo "build.sh: $ORT_DIST missing — run npm install" >&2; exit 1; }

# Which runtime pair each bundle wants is not guessable and has changed
# between onnxruntime versions, so read the names out of the bundles rather
# than hard-coding them, and fail here if one is absent — the alternative is
# a 404 in a visitor's browser.
needed=""
for bundle in ort.webgpu.min.mjs ort.wasm.min.mjs; do
  [ -f "$ORT_DIST/$bundle" ] || { echo "build.sh: missing $ORT_DIST/$bundle" >&2; exit 1; }
  needed="$needed $(grep -o 'ort-wasm[a-z0-9.-]*\.mjs' "$ORT_DIST/$bundle" | sort -u)"
done
for mjs in $(echo "$needed" | tr ' ' '\n' | sort -u); do
  wasm="${mjs%.mjs}.wasm"
  for f in "$mjs" "$wasm"; do
    [ -f "$ORT_DIST/$f" ] || { echo "build.sh: a runtime bundle needs $f, which onnxruntime-web did not ship" >&2; exit 1; }
    cp "$ORT_DIST/$f" "$DIST/ort/$f"
  done
done

# Nothing should have emitted a copy of these into assets/. If something
# does, it is tens of megabytes of dead weight no code path loads, so fail
# rather than ship it quietly.
if compgen -G "$DIST/assets/ort-wasm-*.wasm" >/dev/null; then
  echo "build.sh: onnxruntime wasm leaked into dist/assets — check the aliases in vite.config.js" >&2
  exit 1
fi

log "Copying the models"
mkdir -p "$DIST/models"
for f in "$ROOT/.vendor/models/"*.onnx; do
  [ -e "$f" ] || { echo "build.sh: no models in $ROOT/.vendor/models — run scripts/fetch-models.sh" >&2; exit 1; }
  cp "$f" "$DIST/models/"
done

# The manifest and icons come through public/, so they keep their names. The
# service worker precaches ./manifest.webmanifest by that exact path; a
# content-hashed copy would make its install step fail, and offline support
# would disappear without anything looking broken.
[ -f "$DIST/manifest.webmanifest" ] || {
  echo "build.sh: dist/manifest.webmanifest missing — is it still in public/?" >&2
  exit 1
}

# The service worker's cache name carries a digest of everything in dist/,
# so it changes exactly when the build does. Deriving it beats bumping a
# version string by hand in both directions: a rebuild of an unchanged
# version cannot serve the previous build's index.html forever, and a
# rebuild that changed nothing cannot pointlessly evict a returning
# visitor's cached megabytes.
#
# Hashed from *inside* dist/ so the paths that reach the digest are
# relative — otherwise moving the checkout produces a new id for a
# byte-identical build. The models are excluded: they are pinned by
# checksum, never change, and hashing 300 MB on every build is slow for an
# input that cannot vary.
log "Stamping the service worker"
BUILD_ID=$(
  cd "$DIST" &&
    find . -type f -not -path "./models/*" -print0 |
    LC_ALL=C sort -z |
    xargs -0 shasum -a 256 |
    shasum -a 256 |
    cut -c1-12
)
sed "s/__BUILD_ID__/$BUILD_ID/" "$WEB_DIR/service-worker.js" > "$DIST/service-worker.js"
if grep -q "__BUILD_ID__" "$DIST/service-worker.js"; then
  echo "build.sh: service-worker.js still has an unstamped __BUILD_ID__" >&2
  exit 1
fi

log "Registering the service worker"
node - "$DIST/index.html" <<'NODE'
import { readFileSync, writeFileSync } from "node:fs";
const file = process.argv[2];
const html = readFileSync(file, "utf8");
if (html.includes("service-worker.js")) process.exit(0);
if (!html.includes("</head>")) {
  console.error("build.sh: no </head> in index.html");
  process.exit(1);
}
// Injected here rather than in index.html, because registering a service
// worker only makes sense for the hosted build — `vite dev` would keep
// serving a stale cached bundle behind every edit.
const inject = `
<script>
  window.__installPrompt = null;
  addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    window.__installPrompt = e;
    dispatchEvent(new Event("openpixels:installable"));
  });
  if ("serviceWorker" in navigator) {
    addEventListener("load", () => {
      navigator.serviceWorker.register("./service-worker.js").catch(() => {});
    });
  }
<\/script>`;
writeFileSync(file, html.replace("</head>", inject + "\n</head>"));
NODE

log "Done"
echo "  output: $DIST"
echo "  size:   $(du -sh "$DIST" | cut -f1)"
echo "  models: $(du -sh "$DIST/models" | cut -f1)"
echo
echo "Serve it (a service worker needs an http origin, not file://):"
echo "  npm --prefix apps/web run preview   # http://localhost:8083"
