# Changelog

## 0.1.0 — unreleased

First working version. Every feature is free and runs on the user's own
device; there is no server, no account and no paid tier.

### The web app (`apps/web`)

- Upscaling at 2×, 4× and 8×, plus a "same size, just cleaner" mode that
  runs the model and resamples back down.
- Three denoise strengths, including the middle one Real-ESRGAN performs by
  interpolating two checkpoints — exported here as its own model, since a
  browser cannot blend weights inside an ONNX graph.
- A separate model for drawings and anime, and a slower, more detailed one
  for photographs.
- Face restoration: YuNet finds faces, GFPGAN rebuilds them at 512², and the
  result is pasted back into the enlarged image through a feathered mask.
- Colourisation of black-and-white photographs, taking only hue from the
  model and keeping the photograph's own lightness. It runs the model at
  256² rather than its native 512², since only its low-frequency chroma
  output is used, and warns before colourising a photo that already has
  colour — which replaces real colour with a guess.
- Background removal or replacement.
- Adjustable extra sharpening.
- Batch processing with no limit, a ZIP download and a CSV of measurements.
- **A before/after slider and real quality numbers** — sharpness, noise, and
  a faithfulness check that shrinks the result back down and compares it
  with the original. None of the twelve products surveyed shows either.
- A mobile-first PWA that works offline after the first visit, with a page
  listing every downloaded model and a way to delete them.
- English and Simplified Chinese.

### The extension (`apps/extension`)

- Chrome, Edge and Firefox. Right-click any image and enhance it in a full
  tab hosting the same app.
- No host permissions at install; access is requested for one origin, at the
  moment it is needed.
- Model weights fetched from the website and cached. The Downloads page has
  a field for pointing that at your own copy, so the one thing this
  extension downloads need not come from us; the published checksums make a
  self-hosted copy verifiable.

### The core (`crates/pixels-core`)

- Tiling with a seam-weighted merge, quality metrics, unsharp masking, LAB
  colour with gamut-preserving chroma, matte compositing, and FFHQ face
  alignment. 37 tests.

### Deliberately absent

AI portrait generation. It cannot run on the user's device, so it would
require a server, a price and an account — and the products that offer it
draw steady complaints about altering people's skin tone and features.
