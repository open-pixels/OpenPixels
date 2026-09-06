# OpenPixels

**Make a blurry photo sharp — in the browser, free, with nothing uploaded.**

Upscale to 8×, clear noise and compression artefacts, rebuild faces,
colourise black-and-white photographs, cut out backgrounds, and run a whole
folder at once. Every feature is free with no account, no trial, no
watermark and no limit, because every feature runs on your own device and
costs us nothing per photo.

And the thing none of the twelve products surveyed in
[`PLAN.md`](PLAN.md) does: it shows you **what actually changed** — a
before/after slider, and real measurements underneath.

## The two surfaces

| | |
|---|---|
| **`apps/web`** | The website. A mobile-first PWA; after one visit it works with no signal. |
| **`apps/extension`** | Chrome, Edge and Firefox. Right-click any image on any page and enhance it, in a full tab. Passes Mozilla's validator with zero errors. |

Both are the same application: the extension bundles `apps/web/src` through
a Vite alias rather than keeping a copy, so there is one Studio, one set of
strings and one engine.

## Why it can be free

A photo is processed by your device, so there is no per-photo bill to pass
on. Products that charge for this send your photo to a server and pay for
the GPU that handles it; the subscription covers that. There is no such bill
here.

This is also why the feature list stops where it does. **AI portrait
generation is deliberately absent** — it cannot run on a phone, so it would
need a server, a price, and an account, and the products that offer it draw
steady, specific complaints about altering people's skin tone and features.
Enhancing your photo and inventing a new one are different jobs.

## How it is put together

```
crates/pixels-core   Rust: tiling and seam merge, quality metrics, sharpening,
                     LAB colour, matte compositing, face alignment. 37 tests.
apps/web             Svelte 5 + Vite. The engine runs in a Web Worker.
apps/extension       MV3. Context menu + popup, hosting the same app.
scripts/             torch -> ONNX for the Real-ESRGAN family.
```

The interesting decision is where the seam falls between Rust and
JavaScript. JavaScript owns onnxruntime-web, because only JavaScript can
reach WebGPU. **Rust owns every pixel operation around the forward pass**,
so there is exactly one implementation of the tiling, the blending and the
measurements — and it is the one `cargo test` exercises. JavaScript's whole
share is: hand Rust the bytes, run a tensor through a model, hand back the
output.

Nine ONNX models, all under licences that permit commercial use and
redistribution, every one checksum-pinned. [`MODELS.md`](MODELS.md) lists
each with its provenance, licence and sha256, and says which well-known
models were excluded and why.

## Build

```sh
cargo test -p pixels-core                # the core

npm --prefix apps/web install
npm --prefix apps/web run build          # -> apps/web/dist
npm --prefix apps/web run preview        # http://localhost:8083
npm --prefix apps/web run smoke          # a real browser, a real upscale

npm --prefix apps/extension install
npm --prefix apps/extension run build:all   # -> dist/ and dist-firefox/
npm --prefix apps/extension run e2e         # loads it into Chromium
```

The first web build downloads the upstream weights and converts five of them
with PyTorch; see [`MODELS.md`](MODELS.md). Afterwards the checksums
short-circuit that step.

Install `wasm-opt` (`brew install binaryen`) before a release build and the
core shrinks by about a third; the build script skips it with a note when it
is absent.

## Testing

`cargo test` covers the Rust half — that the tiler merges without a seam,
that PSNR and SSIM match their definitions, that a face crop and paste round
trips, that colourisation preserves lightness even where the sRGB gamut
would otherwise clip it upward.

What that cannot prove is that nine ONNX graphs load in a browser and
produce something better than the input, so `npm run smoke` does exactly
that: a real Chromium, a real photo, a real upscale, and an assertion that
the measured sharpness went up and the SSIM against the original stayed
high.

## Licence

MIT or Apache-2.0, at your option. The models carry their own licences,
listed in [`MODELS.md`](MODELS.md).
