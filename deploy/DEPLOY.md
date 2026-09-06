# Deploying OpenPixels

The site is a folder of static files and nothing else. There is no server
process, no database and no API — which is the same fact the About page
states, so any deployment that adds one has broken the product's central
claim.

## Build

```sh
npm --prefix apps/web install
npm --prefix apps/web run build      # -> apps/web/dist  (~550 MB, 512 MB of it models)
```

The build fetches and checksums the weights on first run. It needs Python
with `torch`, `onnx`, `onnxruntime` and `onnxconverter-common` for the
conversion step, once — after that `.vendor/models` is cached and the
checksums short-circuit it.

## Publish

```sh
rsync -av --delete apps/web/dist/ server:/var/www/openpixels/
```

`deploy/openpixels.app.conf` is the nginx server block. Three things in it
are load-bearing and explained in its comments: the `.mjs` MIME type, the
`.wasm` MIME type, and caching the models forever while never caching
`index.html` or the service worker.

Check a deployment with:

```sh
curl -sSI https://openpixels.app/ort/ort-wasm-simd-threaded.mjs | grep -i content-type
# content-type: text/javascript          <- not application/octet-stream
curl -sSI https://openpixels.app/models/realesr_general_x4v3.onnx | grep -i 'access-control\|cache-control'
# both present, or the extension cannot fetch models
```

## The models are a public dependency

The browser extension fetches weights from `https://openpixels.app/models/`
because a store package cannot carry half a gigabyte. That makes those URLs an API:
**never rename or remove a file that a released extension asks for.** A new
model is a new filename and a new extension version.

Anyone can host their own copy — `MODELS.md` lists every checksum — and
point an installed extension at it from its **Downloads** page.

## What a visitor downloads

| | |
|---|---|
| app JS + CSS | ~48 KB gzipped |
| fonts (3 faces) | 41 KB |
| `pixels_core_bg.wasm` | 194 KB (88 KB gzipped) |
| ONNX runtime | 14 MB (CPU) **or** 26 MB (WebGPU) |
| the fast upscaling model | 4.9 MB |

Exactly one ONNX runtime is fetched: the app picks the WebGPU build when the
browser has WebGPU and the CPU build when it does not. Both are shipped,
which costs disk on the host and nothing on the wire.

Models are fetched on first use with a progress bar, not precached — someone
reading the pricing page should not silently pull hundreds of megabytes. The
face restorer is 170 MB and the colouriser 255 MB, and the app says so
before either starts.
