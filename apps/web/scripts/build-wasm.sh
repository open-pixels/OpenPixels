#!/usr/bin/env bash
# Compiles pixels-core for the browser and writes the JS glue into
# apps/web/src/wasm/, which the pipeline imports.
#
# SIMD is what makes the Rust half tolerable on a phone: the resampling,
# the guided ramps in the tile merger, the LAB conversion and the metrics
# are all per-pixel loops. Every browser this app supports has had SIMD for
# years.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(dirname "$SCRIPT_DIR")"
ROOT="$(cd "$WEB_DIR/../.." && pwd)"
OUT="$WEB_DIR/src/wasm"

: "${CARGO_TARGET_DIR:=$HOME/.cache/openpixels-target}"
export CARGO_TARGET_DIR

log() { printf '\033[1m==> %s\033[0m\n' "$1"; }

if ! rustup target list --installed | grep -qx wasm32-unknown-unknown; then
  log "Adding the wasm32-unknown-unknown target"
  rustup target add wasm32-unknown-unknown
fi

if ! command -v wasm-bindgen >/dev/null 2>&1; then
  echo "build-wasm.sh: wasm-bindgen CLI not found. Install the pinned version:" >&2
  echo "  cargo install wasm-bindgen-cli --version 0.2.126 --locked" >&2
  exit 1
fi

# The CLI and the crate verify each other's version and refuse to run when
# they differ. Catching it here beats a wall of schema errors.
want="$(grep -m1 'wasm-bindgen = "=' "$ROOT/Cargo.toml" | sed 's/.*"=\(.*\)".*/\1/')"
have="$(wasm-bindgen --version | awk '{print $2}')"
if [ "$want" != "$have" ]; then
  echo "build-wasm.sh: wasm-bindgen CLI is $have, Cargo.toml pins $want" >&2
  echo "  cargo install wasm-bindgen-cli --version $want --locked --force" >&2
  exit 1
fi

log "Compiling pixels-core for wasm32"
RUSTFLAGS="${RUSTFLAGS:-} -C target-feature=+simd128" \
  cargo build --manifest-path "$ROOT/Cargo.toml" \
  -p pixels-core --target wasm32-unknown-unknown --release

log "Generating the JS bindings"
rm -rf "$OUT"
wasm-bindgen --target web --out-dir "$OUT" --no-typescript \
  "$CARGO_TARGET_DIR/wasm32-unknown-unknown/release/pixels_core.wasm"

if command -v wasm-opt >/dev/null 2>&1; then
  log "Optimising with wasm-opt"
  # Every feature rustc emits for this target has to be named, or wasm-opt
  # rejects the input it was just handed — "error validating input", with
  # the offending instruction printed and no mention of which flag turns it
  # on. Bulk memory is the one that bites first (every `memory.fill` rustc
  # generates for a zeroed Vec), and SIMD is switched on above.
  wasm-opt -Oz     --enable-simd     --enable-bulk-memory     --enable-nontrapping-float-to-int     --enable-sign-ext     --enable-mutable-globals     --enable-reference-types     --enable-multivalue     "$OUT/pixels_core_bg.wasm" -o "$OUT/pixels_core_bg.wasm.opt"
  mv "$OUT/pixels_core_bg.wasm.opt" "$OUT/pixels_core_bg.wasm"
else
  echo "  (wasm-opt not installed — output is ~30% larger; brew install binaryen)"
fi

log "Done: $OUT"
ls -la "$OUT"
