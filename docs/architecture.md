# Architecture

## The seam

`ort`, the Rust ONNX runtime, has no wasm32 target, and the pure-Rust
alternatives are far too slow for a super-resolution model on a phone. So
**JavaScript runs the ONNX graphs**, through onnxruntime-web, which reaches
WebGPU and SIMD that a Rust wasm module cannot.

Everything else is Rust:

| | |
|---|---|
| tile planning, padding, seam-weighted merge | `tile` |
| PSNR, SSIM, Laplacian sharpness, Immerkær noise | `metrics` |
| unsharp masking | `filters` |
| sRGB ↔ CIE L\*a\*b\*, gamut-preserving colourisation merge | `color` |
| U²-Net preprocessing, matte compositing | `matte` |
| YuNet pre/post-processing, FFHQ alignment, feathered paste-back | `face` |
| resampling | `resize` |

That split exists so there is one implementation of the letterboxing, the
normalisation constants, the landmark decode and the metric definitions. A
JavaScript reimplementation would agree on the day it was written and drift
silently afterwards, and the failure mode is not a crash — it is numbers
that quietly stop meaning what the panel says they mean.

## Threading

Everything runs in one Web Worker. A 4× pass takes tens of seconds on a
phone, and the compare slider, the cancel button and the batch list all have
to keep responding. It is also where the large buffers live, which keeps a
big photo from taking the tab down with it.

One worker, not one per job: model sessions cost hundreds of megabytes to
build and a batch reuses them.

The protocol is deliberately small — `config`, `job`, `cancel`, `cached`,
`forget`, `release`; `progress` out repeatedly, then `done` or `error`.
Cancellation is cooperative: the pipeline yields between tiles and the
worker checks a flag there.

## Tiling, and why every tile is the same size

A model's memory grows with its input, so a large photo is cut into tiles
with an overlap band, and the merger crossfades the band so no seam shows.

The tiles at the right and bottom edges are naturally smaller, and a
dynamic-axis ONNX graph accepts that happily — on the CPU backend. On
WebGPU it fails:

```
Shape mismatch attempting to re-use buffer. {1,288,288,3} != {1,1152,1152,3}
```

onnxruntime plans its buffers on the first run and reuses them. Two separate
things went wrong here and both had to be fixed:

1. **Tiles of different shapes between runs.** Fixed by padding every tile
   to one `tile + 2 × overlap` square, replicating edge pixels rather than
   filling with black — a hard black border is a strong edge, and the model
   would faithfully sharpen it into the result. The square is a pure
   function of the tile settings, never of the photo, so a session built
   around it survives the next image.
2. **Within a single run**, the Real-ESRGAN graphs add the network output to
   the input resized 4×, and the planner tried to write the 4× tensor into
   the buffer it read the input from. Fixed by `enableMemPattern: false`,
   with `freeDimensionOverrides` pinning the named axes so the remaining
   optimisation still happens.

Neither error names the tile that changed or the option that fixes it; both
point at an onnxruntime source path and suggest checking the model's
`dim_param`s, which is the wrong place — the export is correct.

`plan` also pulls the last row and column back to a full tile rather than
leaving a sliver, so the padding is rarely more than a few percent of wasted
work.

## Pipeline order

```
colourise → detect faces → upscale → restore faces → sharpen → background → measure
```

Two orderings here are deliberate:

- **Colourisation runs first**, on the smaller image. It only decides hue,
  so deciding it before the enlargement costs nothing and saves a large
  resample. Only the a and b channels are taken from the model; lightness
  stays the photograph's own.

  It also runs the model at 256² rather than its native 512². Chroma in a
  photograph is low-frequency and gets upsampled to the original's size
  regardless, so the larger edge costs four times the work for a difference
  the upsample erases. That is not a micro-optimisation: at 512² this step
  took long enough on a CPU backend to dominate the entire pipeline, and it
  is the one place in this app where the obvious "use the model's native
  resolution" choice is the wrong one.
- **Faces are detected before the upscale but restored after it.** GFPGAN
  works at a fixed 512², so pasting its output into the *larger* image is
  what preserves its detail. Detecting on the upscaled image would cost four
  times the work for landmarks that are no more accurate.

## Measurements

There is no ground-truth high-resolution image, so "is this faithful?"
cannot be answered by comparing to one. Instead the result is shrunk back to
the input's size and compared with the input: high PSNR and SSIM there mean
the model enlarged what was present rather than inventing something else.
That is the honest check, and it is the one a user actually wants — the
category's worst failure is a tool that hallucinates a different face.

Sharpness is the variance of the Laplacian, measured against the same input
enlarged with a plain resampler, so the ratio reads as "how much sharper
than just making it bigger". Noise is Immerkær's estimator. Both are taken
on the same window of the image, capped at 1024² so a 40 MP result does not
take seconds to score.

The panel leads with a sentence and keeps the numbers behind a disclosure:
the audience for this product does not know what SSIM is, and a panel that
opens with it teaches them nothing.

## Memory

A browser tab has a hard ceiling, and crossing it kills the tab with no
message. The worker caps the working size so the *output* lands near 40 MP —
larger than any screen or an A3 print needs — and reports the size it used,
which the Studio shows. The merger accumulates in 16-bit fixed point rather
than `f32`, halving the peak for a large output.

## The extension

The research this project answers concluded that no competitor ships a
browser extension and that this is "unfilled for a reason": the flow needs
an upload, a progress display, a comparison and a download, none of which
fit a popup.

That reasoning is right about *popups*. So the popup here is a door, not a
workspace — the work happens in a full extension tab hosting the same app.
What the extension adds is the one thing a website cannot: starting from an
image already on a page, with no save-then-upload round trip.

Two constraints shape it:

- **No host permissions at install time.** A "read all your data on every
  website" prompt is a heavy price for a tool most people use twice.
  Permission is requested for one origin, at the moment it is needed, from a
  click — which is also the only way `permissions.request` works.
- **Models are fetched from the website.** A store package cannot carry
  half a gigabyte. Chrome forbids fetching *code* remotely, which is why the wasm
  core and the ONNX runtime are bundled; the weights are data, and are not.
  The origin is a setting on the Downloads page, so anyone can self-host the
  same checksummed files. That page is shared with the website, which has
  nothing to configure — so the row appears only when the host passes a
  handle for it, and the shared component never learns that an extension
  exists.
