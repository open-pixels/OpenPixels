# OpenPixels on the web

The product: a static page that upscales, denoises, restores faces,
colourises and cuts out backgrounds, entirely inside the browser tab.
Nothing is uploaded, because there is no server to upload it to.

```sh
npm install
npm run build      # -> dist   (~550 MB, 512 MB of it model weights)
npm run preview    # http://localhost:8083
```

Serve it over http, not `file://` — a service worker needs an origin. The
output is static; any file host will do. See `deploy/DEPLOY.md` for the
three headers that are not optional.

## Mobile first, and not as a slogan

The research this project answers found that no competitor treats the mobile
browser as the primary target, and that the photos this product exists for
are already on a phone. So every layout here is one column, the widest
breakpoint is a reading width, no control is under 44 px, the camera and
gallery pickers are separate buttons, and the whole thing installs to a home
screen and works with no signal after one visit.

There is no desktop layout, and that is a decision rather than an omission —
a second layout is a second thing to design, test and keep working, for the
smaller half of the traffic.

## Where the work happens

```
src/lib/engine/   ort.js       which onnxruntime build to fetch, and its session options
                  models.js    the catalogue, the cache, and progress reporting
                  pipeline.js  what runs in what order — the only place that knows
                  worker.js    the worker it all runs inside
                  client.js    the main thread's handle on that worker
src/lib/          image.js     decode, encode, the before/after sheet
                  download.js  saving, the ZIP, the CSV
                  i18n.js      English and Simplified Chinese
                  options.js   job options and the progress sentences
src/views/        Home, Studio, Batch, Models, About
src/ui/           Compare.svelte and Quality.svelte are the differentiating bits
```

Everything that touches a pixel is Rust, in `crates/pixels-core`, reached
through `src/wasm/`. JavaScript's share is: hand Rust the bytes, run a
tensor through a model, hand back the output. `docs/architecture.md` has the
reasoning.

**Nothing on the main thread loads the wasm module.** The worker owns it,
which is why `image.js` has its own small RGBA↔RGB conversions and its own
cheap monochrome heuristic — calling into `core` from a view fails at run
time with an error naming a wasm-bindgen internal, a long way from the
mistake.

## What a visitor downloads

| | |
|---|---|
| app JS + CSS | ~48 KB gzipped |
| fonts (3 faces) | 41 KB |
| `pixels_core_bg.wasm` | 194 KB (88 KB gzipped) |
| ONNX runtime | 14 MB (CPU) **or** 26 MB (WebGPU) |
| the fast upscaling model | 4.9 MB |

Exactly one ONNX runtime is fetched — the app picks at run time and both are
shipped, which costs disk on the host and nothing on the wire.

Weights are fetched on first *use*, with a real progress bar, never
precached: someone reading the pricing page should not silently pull
hundreds of megabytes. The Downloads screen lists what is on the device and
deletes it, which is also what releases the loaded sessions.

## Tests

```sh
npm run smoke      # a real Chromium, a real photo, a real upscale — fast
npm run features   # faces, colour, cut-out, 8x, batch — slow, ~300 MB of weights
```

`smoke` asserts on the app's own reported measurements: sharpness up, SSIM
against the original still high. `features` additionally samples the
colourised result's pixels, because "it finished" and "it added colour" are
different claims.
