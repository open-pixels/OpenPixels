# Models

Nine ONNX files, all with licences that permit commercial use and
redistribution. Every one is served from the app's own origin, never from a
third party at run time: a cross-origin request timed to the moment someone
opens a private photo would undercut the privacy claim even though the image
itself never moves.

`apps/web/scripts/fetch-models.sh` downloads or builds all of them and
verifies every checksum below. Five are produced by
`scripts/export-models.py` because Real-ESRGAN publishes PyTorch weights
only; that script checks each conversion against the PyTorch forward pass
before writing it.

| File | Bytes | Licence | Provenance |
|---|---|---|---|
| `realesr_general_x4v3.onnx` | 4,866,422 | BSD-3-Clause | Exported from `realesr-general-x4v3.pth` (Real-ESRGAN v0.2.5.0) |
| `realesr_general_x4v3_dn50.onnx` | 4,866,422 | BSD-3-Clause | The 50/50 interpolation of the wdn and plain weights |
| `realesr_general_wdn_x4v3.onnx` | 4,866,422 | BSD-3-Clause | Exported from `realesr-general-wdn-x4v3.pth` |
| `realesrgan_x4plus.onnx` | 67,051,644 | BSD-3-Clause | Exported from `RealESRGAN_x4plus.pth` (v0.1.0) |
| `realesrgan_x4plus_anime_6b.onnx` | 17,939,969 | BSD-3-Clause | Exported from `RealESRGAN_x4plus_anime_6B.pth` (v0.2.2.4) |
| `gfpgan_1.4_fp16.onnx` | 170,261,734 | Apache-2.0 | `facefusion/models-3.0.0`, halved to fp16 |
| `deoldify_artistic.onnx` | 255,044,725 | MIT | `facefusion/models-3.0.0`, as published |
| `u2netp.onnx` | 4,574,861 | Apache-2.0 | rembg release `v0.0.0` |
| `face_detection_yunet_2023mar.onnx` | 232,589 | MIT | OpenCV Zoo |

```
0e121299bf9b23a764d3f9e2120d0d0727d5ac5032e03a46cb78d28bcc7c6872  realesr_general_x4v3.onnx
b345bc59c38dbb78d871b5adf9519c475fe243c198f70cc9d0b97a464715d50b  realesr_general_x4v3_dn50.onnx
be536211515f088de05f1aa799a8079e92f49978b47aad6cec007f9fca62bb68  realesr_general_wdn_x4v3.onnx
800a80063abcc8db53f6579407347ac2d53a9f5697dcc839cff38fbd806faf37  realesrgan_x4plus.onnx
46c5fe739aa63319ad027112abfbee1d8bf6219a17ed36fccb5f454ad8c69011  realesrgan_x4plus_anime_6b.onnx
a94d1ae4353e9fee4f7dae2639bf9b3311188eab3d40b9ec8cc821e8aa42db3c  gfpgan_1.4_fp16.onnx
9ac296cf05fecbdb604f50211f632b722402bc1f9a96ee5a8987b01c0c3c688f  deoldify_artistic.onnx
309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8  u2netp.onnx
8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4  face_detection_yunet_2023mar.onnx
```

## The rule

**Only weights whose licence permits commercial use and redistribution.**
That excludes a large part of what is popular in this field:

- **CodeFormer** (NTU S-Lab 1.0) — non-commercial. It restores faces
  slightly better than GFPGAN on severe degradation; it cannot ship here.
- **GPEN** (S-Lab / non-commercial in its released form), **RestoreFormer++**
  (S-Lab) — same reason.
- **BSRGAN, SwinIR** — Apache-2.0 and usable, but no better than
  Real-ESRGAN on real-world degradation at several times the size.
- **Real-CUGAN** — better than Real-ESRGAN on anime, and MIT, but the
  released weights are 200 MB+ per denoise level and there are five levels.

## Two notes on what these files are

**The denoise blend.** Real-ESRGAN's `--denoise_strength` linearly
interpolates two state dicts before inference. A browser cannot interpolate
weights inside an ONNX graph, so the middle setting is exported as its own
file. Three 4.9 MB files is a better trade than one plus a weight-blending
implementation that would have to be verified against upstream.

**fp16, and where it stops.** GFPGAN halves cleanly, from 340 MB to 170 MB;
the export script checks the halved graph against the original on real input
and refuses to write one that drifts.

**DeOldify ships at full precision**, at 255 MB, and that is deliberate.
Halving it needs `Cast` and `Clip` left in fp32 — with the defaults the
conversion writes a file that onnxruntime then refuses to load, reporting a
type error at a node several hundred layers from the cause. With those
blocked it converts correctly, but the conversion itself wants more memory
than a normal machine has free, and a build step that is killed partway
leaves a *plausible-looking* broken model behind. Trading 128 MB for a step
that can fail silently in that particular way is a bad trade for the one
model most users will never download. If you have the memory, the settings
are recorded in `docs/model-export.md`.

The Real-ESRGAN family is not halved either — at 4.9 MB there is nothing to
save, and the WebGPU backend is happier with fp32 inputs.
