# Testing

Three layers, each covering what the one below cannot.

## `cargo test -p pixels-core` — 37 tests, sub-second

The Rust half, where the arithmetic lives. The tests worth knowing about:

- **`identity_model_round_trips_exactly`** — an identity "model" over a
  tiled image reproduces the input to within one count. This is the seam
  test: if the merge weights are wrong anywhere, they are wrong here.
- **`disagreeing_tiles_crossfade`** — two tiles that disagree completely
  produce a monotonic ramp, not a step. A seam that fades is invisible; a
  seam that jumps is the first thing anyone notices.
- **`every_tile_pads_to_one_constant_square`** — across five image sizes,
  every tile reaches the model at exactly one shape. This is the property
  the WebGPU backend depends on; see `docs/architecture.md`.
- **`psnr_of_identical_is_infinite_and_known_offset_matches_formula`** —
  checked against the closed form, not a golden value.
- **`gamut_mapping_preserves_lightness_where_clipping_would_not`** — a
  confident warm cast on a near-black pixel is outside sRGB, and naive
  clipping resolves it by *raising* lightness, so a black coat comes back
  lifted and brown. The test asserts the mapped version keeps L and the
  clipped one does not.
- **`crop_then_paste_at_full_strength_reproduces_the_face_region`** and
  **`paste_into_an_upscaled_target_lands_in_the_right_place`** — the face
  alignment round trip, including into a target four times larger, which is
  how it is actually used.
- **`decode_reads_a_planted_detection`** — YuNet's strided head decode
  against a hand-built detection with known coordinates.

## `npm --prefix apps/web run smoke` — a real browser

What unit tests cannot prove: that nine ONNX graphs load in a browser, that
the preprocessing matches what they were trained on, and that the output is
*better* than the input.

It serves `dist/`, opens Chromium at a phone viewport, picks a real photo,
runs a real upscale, and asserts on the measurements the app itself reports:
sharpness up by more than 5%, SSIM against the original above 0.6. It also
downloads both files, and fails on any console error, failed request or 404.

Screenshots land in `apps/web/e2e/output/`. Run it with `--headed` to watch.

## `npm --prefix apps/extension run e2e` — a real extension

Loads the built extension into Chromium and checks the things that only
break at load time: the manifest, the service worker registering, the popup
and app page finding their bundles after the build flattens them, and —
the important one — **inference under the extension's content security
policy**, which needs `wasm-unsafe-eval` and fails only at run time when it
is missing.

It runs against a local model server rather than the live site, through the
same `modelOrigin` setting a self-hoster would use, so it works offline.

This is the layer that caught the WebGPU buffer-reuse bug: the web smoke
test passes on a headless shell with no WebGPU, and the extension test uses
the full Chromium, which has it. **A green web run does not imply a green
extension run**, and that is not incidental — it is the difference between
testing the slow path and the fast one.

## `check-manifest.mjs`

Runs as part of every extension build and refuses to emit a package a
browser would reject: a manifest naming a missing file, an uncopied icon, a
background script that is not a module, an unresolved `__MSG_` placeholder,
a missing ONNX runtime, or a package over the 100 MB store limit. Store
review is a slow way to find these out.
