# OpenPixels — implementation plan

Free, local image enhancement in the browser: upscale, denoise, deblur,
face restore, colorise old photos, remove backgrounds, batch — and, unlike
every product in the competitive research, a before/after slider with real
quality numbers next to it.

The research this plan answers is
`20260904-竞品分析/图像增强:超分 Web独立站/…产品竞争格局调研-189.md`. Its
conclusions, and what this plan does with each, are in §1. The brief on top
of it: **every feature is free**, including the ones the research placed in
the paid tier; **web app and browser extension come first**.

Status at the bottom of this file is kept current as milestones land.

---

## 1. What the research decided, and what we do with it

| Finding (section) | Decision |
|---|---|
| Quality-metric display is a 12/12 industry blank (§五 5.1) | P0. Before/after slider by default; plain-language numbers (sharper by ×, noise before→after, fidelity to the original) with PSNR/SSIM one tap away. |
| Everything in the MVP can run locally for free (§五 5.2, §六) | The whole product is local. No account, no server, no upload, no limits. |
| "Subscription + credits, opaque pricing, called a scam" is the top shared complaint (§五 5.3) | There is no pricing. There is also no OpenApps sign-in: the integration guide says a feature that runs on the user's machine cannot be metered, so there is nothing to sign in *for*. |
| Users are on phones; the photo is already on the phone (§三, §八 ⑤) | Mobile-first PWA: camera/gallery pickers, 44px targets, add-to-home-screen, works offline after the first visit. |
| Browser extension form is "unfilled for a reason" (§八 ④) | The brief overrides this: the extension exists, but it is not a popup that processes images. It is a right-click entry point ("Enhance this image") that opens the full app in an extension tab. That sidesteps every reason §八 ④ gives. |
| Paid tier should be 8× / cloud batch (§十 10.2) | Both are free and local: 8× is two passes of the 4× model; batch is an unlimited in-page queue. |
| Don't build AI-portrait generation (§九 切入点3) | Not built. It needs a cloud GPU, cannot be private, and Remini's reviews show the skin-tone/ethnicity failure mode. This is the one feature from the matrix that is deliberately absent. |
| Colourisation was "undecided" (§五 5.2) | Built, free, local (DeOldify, MIT). Flagged as a large download and better on a laptop. |
| Background removal was "opportunity, not MVP" (§五 5.2) | Built, because it is 5 MB (U²-Net-p) and the pipeline already exists. |
| Cold start on TikTok/Instagram with before/after visuals (§七) | The compare slider exports a side-by-side "before / after" PNG in one tap, made for exactly that. |

## 2. Feature list (all free)

| # | Feature | How | Model | Download |
|---|---|---|---|---|
| F1 | Upscale 2×/3×/4× | Real-ESRGAN general x4v3 (fast) or x4plus (quality); output resampled to the chosen factor | BSD-3 | 5 MB / 67 MB |
| F2 | Upscale 8× | Two 4× passes | same | — |
| F3 | Denoise | Three strengths: the x4v3 model, its "wdn" sibling, and a 50/50 weight blend exported as a third model — the same interpolation Real-ESRGAN's `--denoise_strength` performs | BSD-3 | 5 MB each |
| F4 | JPEG artifacts / grain | Same models (trained on the real-world degradation pipeline), plus an "enhance without enlarging" mode that runs 4× and resamples back to 1× | — | — |
| F5 | Anime / illustration | Real-ESRGAN x4plus_anime_6B | BSD-3 | 18 MB |
| F6 | Sharpen | Unsharp mask in Rust, adjustable, live preview | — | — |
| F7 | Face restore / deblur | YuNet detects → 5-point alignment → GFPGAN 1.4 at 512² → blended back with a feathered mask | MIT + Apache-2.0 | 0.2 MB + 340 MB (fp16 170 MB) |
| F8 | Old-photo restore | Preset: denoise strong + face restore + optional colourise | — | — |
| F9 | Colourise | DeOldify artistic at 256²; L channel from the original, ab from the model | MIT | 255 MB (fp32 — see MODELS.md) |
| F10 | Background removal | U²-Net-p at 320²; matte → transparent PNG or solid colour | Apache-2.0 | 5 MB |
| F11 | Batch | Unlimited queue, sequential, same settings, ZIP download + CSV of metrics | — | — |
| F12 | Local / offline | Everything in the tab. PWA precaches the shell; weights cached on first use | — | — |
| F13 | Quality metrics | Compare slider; sharpness (Laplacian variance), noise (Immerkær), fidelity (PSNR/SSIM of output↓ vs input), all in Rust | — | — |
| F14 | Share graphic | Side-by-side before/after PNG export | — | — |
| F15 | Extension | Right-click any image → full app in a tab; popup drop-zone; Chrome/Edge/Firefox | — | — |

## 3. Architecture

```
openpixels/
├── Cargo.toml                    workspace
├── crates/pixels-core/           Rust: tiling, seam merge, metrics, sharpen, LAB,
│                                 compositing, face paste-back. wasm-bindgen behind
│                                 cfg(target_arch = "wasm32"). Unit-tested natively.
├── apps/web/                     Svelte 5 + Vite PWA. The product.
│   ├── src/lib/engine/           ort loader, model registry + cache, worker, pipeline
│   ├── src/lib/                  i18n (en, zh-CN), zip, download, settings
│   ├── src/views/                Home, Studio, Batch, Models, About
│   ├── scripts/                  build-wasm.sh, fetch-models.sh, build.sh
│   └── service-worker.js
├── apps/extension/               MV3. Reuses apps/web/src through a Vite alias.
│   ├── src/background.ts         context menu, fetch-with-permission, inbox
│   ├── src/popup/                drop zone → opens the app tab
│   ├── src/app/                  the same Svelte app, extension entry
│   └── public/manifest*.json     Chrome + Firefox
├── scripts/export-models.py      torch → ONNX for the Real-ESRGAN family
├── MODELS.md                     every weight: source, licence, sha256, size
├── deploy/                       nginx conf, DEPLOY.md
└── docs/                         architecture, testing, store listing
```

**Where the seam falls.** Same as openframe: JavaScript owns onnxruntime-web
(WebGPU when present, wasm CPU otherwise) because Rust cannot reach WebGPU;
Rust owns every pixel operation around the forward pass so there is exactly
one implementation of tiling, blending and the metrics, and it is the one
`cargo test` exercises.

**Worker.** Inference and the Rust core run in a Web Worker. A 4× pass on a
phone can take twenty seconds; the compare slider and the cancel button must
keep working during it.

**Tiling.** Every model runs on tiles (default 192 px, 16 px overlap on the
input side) so peak memory is flat regardless of input size. Rust plans the
tiles and merges outputs with linear seam ramps.

**Models.** Served from the app's own origin (`./models/`), sha256-pinned at
build time, cached in Cache Storage after first use, deletable from the
Models page. The extension cannot ship 500 MB, so it fetches the same files
from `https://openpixels.app/models/` (overridable in its settings).

**Colour management.** Inputs are decoded through `createImageBitmap` with
EXIF orientation applied; all math is sRGB 8-bit in, f32 in the models, 8-bit
out. Output is PNG by default (lossless — the point of the tool) with JPEG
and WebP at chosen quality.

## 4. Milestones

| M | Deliverable | Verify |
|---|---|---|
| M0 | `pixels-core` with tests: tile plan/merge round-trip, PSNR/SSIM known values, unsharp, LAB round-trip, matte compositing, face paste-back | `cargo test` |
| M1 | Model export + pins: 5 Real-ESRGAN ONNX files exported and numerically checked against PyTorch; GFPGAN/DeOldify/U²-Net-p/YuNet fetched; `MODELS.md` | Python ORT parity ≤ 1e-3 |
| M2 | Web app: Home → Studio single-image flow, all F1–F10, compare slider + metrics, PWA | `vite build`, headless Chromium smoke |
| M3 | Batch + ZIP + CSV, Models page (cache management), About/Privacy, zh-CN | build |
| M4 | Extension: Chrome + Firefox builds, context menu, popup, in-tab app | build both, manifest lint |
| M5 | Deploy docs, nginx, store listing, README, CHANGELOG | review |

## 5. Not in this plan

- AI portrait generation (see §1).
- Native mobile or desktop apps. The PWA covers "phone, no install";
  openframe's Tauri path exists if a desktop build is wanted later.
- Any server. There is no backend to run.

---

## Status

All milestones complete and verified in a real browser.

| M | State | Evidence |
|---|---|---|
| M0 | done | `cargo test -p pixels-core` — 37 tests, clippy clean at `-D warnings` |
| M1 | done | 9 models exported and pinned; `MODELS.md`, `scripts/export-models.py` |
| M2 | done | `npm --prefix apps/web run smoke` — 14/14, real upscale in Chromium |
| M3 | done | batch, ZIP, CSV, Downloads page, zh-CN; covered by `run features` |
| M4 | done | `npm --prefix apps/extension run e2e` — 10/10, Chrome + Firefox builds |
| M5 | done | `deploy/`, `docs/`, `README.md`, `CHANGELOG.md`, store listing |

### What changed against this plan while building it

- **F1/F3**: the "denoise" tiers are three separate exported models rather
  than a runtime blend, because a browser cannot interpolate weights inside
  an ONNX graph. Three 4.9 MB files, no blending code to verify.
- **F9**: colourisation runs the model at 256² rather than 512². Only the a
  and b channels are used and chroma is low-frequency, so the larger edge
  costs four times the work for a difference the upsample erases — and at
  512² it was the slowest thing in the app.
- **Tiling**: every tile is padded to one constant square. Feeding a
  dynamic-axis graph tiles of different shapes works on the CPU backend and
  fails on WebGPU, which is the path most people will actually get. See
  `docs/architecture.md`.
- **Colour**: out-of-gamut colour is resolved by pulling chroma toward the
  neutral axis, not by clipping channels, which would raise lightness and
  turn a black coat brown. A unit test pins this.

`docs/decisions.md` records where this project departed from the research's
recommendations, and why.
