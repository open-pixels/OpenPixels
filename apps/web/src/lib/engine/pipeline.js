/**
 * The jobs themselves: what runs, in what order, on which tensors.
 *
 * This module is the one place that knows a pipeline's shape. It runs
 * inside a worker (see worker.js) so a twenty-second upscale never freezes
 * the compare slider or the cancel button.
 *
 * Every pixel operation is a call into Rust (`pixels-core`). What lives
 * here is only sequencing: which model, over which tiles, in which order,
 * with progress reported between steps.
 */

import init, * as core from "$wasm/pixels_core.js";
import { createSession, hasWebGPU } from "./ort.js";
import { fetchModel, MODELS, srModel } from "./models.js";

let wasmReady;

/**
 * `init()` with no argument uses the glue's own
 * `new URL("pixels_core_bg.wasm", import.meta.url)`, which the bundler
 * rewrites to the content-hashed copy it emitted. Passing a path of our own
 * would make it fetch a *second*, unhashed copy that the build has no
 * reason to produce — 200 KB of 404 on the first press of Enhance.
 */
export function loadWasm() {
  wasmReady ??= init();
  return wasmReady;
}

// Sessions are expensive to build and cheap to keep, and a batch runs the
// same model over and over.
//
// Keyed by model *and* input square, because the square is pinned into the
// session's options; a different one needs a different session, not a
// different call.
const sessions = new Map();

async function session(id, onProgress, pad = 0) {
  const key = `${id}:${pad}`;
  if (sessions.has(key)) return sessions.get(key);
  const bytes = await fetchModel(id, onProgress);
  const made = await createSession(bytes, { pad });
  sessions.set(key, made);
  return made;
}

export function releaseSessions() {
  for (const { session: s } of sessions.values()) s.release?.();
  sessions.clear();
}

const OVERLAP = 16;

/**
 * How large a tile to feed the model.
 *
 * Decided from whether the browser *has* WebGPU rather than from the
 * provider a session ended up with, because the tile size determines the
 * input square, the input square is pinned into the session's options, and
 * the session does not exist yet. A machine whose WebGPU then turns out to
 * refuse the graph runs slightly larger tiles on the CPU than it would have
 * chosen — slower, still correct — which is the right way round: the other
 * order cannot be built at all.
 */
function tileSize(model) {
  const gpu = hasWebGPU();
  if (model === "sr_quality") return gpu ? 192 : 128;
  return gpu ? 256 : 192;
}

async function run(made, feeds) {
  const out = await made.session.run(feeds);
  return out[made.session.outputNames[0]];
}

function tensor(ort, data, dims) {
  return new ort.Tensor("float32", data, dims);
}

/**
 * Super-resolution over tiles.
 *
 * `factor` is what the user asked for; the models are all 4x, so a 2x
 * request runs the model and resamples down (which is sharper than running
 * a dedicated 2x model would be at this size), and 8x runs two passes.
 */
export async function upscale(img, opts, report) {
  const { factor = 2, kind = "photo", denoise = "off" } = opts;
  const id = srModel({ kind, denoise });
  const tile = tileSize(id);
  const pad = tile + 2 * OVERLAP;
  const made = await session(id, (p) => report({ stage: "download", model: id, progress: p }), pad);
  const { ort } = made;
  const modelScale = MODELS[id].scale;

  const passes = factor > 4 ? 2 : 1;
  let current = img;
  for (let pass = 0; pass < passes; pass++) {
    const planJson = core.plan_tiles(current.width, current.height, tile, OVERLAP);
    const plan = JSON.parse(planJson);
    const merger = new core.TileMerger(planJson, modelScale);
    // Every tile goes in at `plan.pad` square — the same square pinned into
    // the session above. Varying the shape between runs is what WebGPU
    // rejects; see the tile module's docs.
    if (plan.pad !== pad) throw new Error(`tile plan pad ${plan.pad} does not match the session's ${pad}`);
    for (let i = 0; i < plan.tiles.length; i++) {
      const t = plan.tiles[i];
      const chw = core.extract_tile(current.width, current.height, current.data, t.x, t.y, t.w, t.h, pad);
      const out = await run(made, { input: tensor(ort, chw, [1, 3, pad, pad]) });
      merger.add(i, out.data);
      out.dispose?.();
      report({
        stage: "upscale",
        pass: pass + 1,
        passes,
        progress: (pass + (i + 1) / plan.tiles.length) / passes,
      });
      // Yield, so a cancel between tiles is honoured promptly.
      await Promise.resolve();
    }
    current = { width: merger.width(), height: merger.height(), data: merger.finish() };
    merger.free();
  }

  // Land exactly on the requested factor.
  const wantW = Math.max(1, Math.round(img.width * factor));
  const wantH = Math.max(1, Math.round(img.height * factor));
  if (current.width !== wantW || current.height !== wantH) {
    current = {
      width: wantW,
      height: wantH,
      data: core.resize_rgb(current.width, current.height, current.data, wantW, wantH, 0),
    };
  }
  return current;
}

/** Enhance without enlarging: run the model, then come back to 1x. */
export async function enhanceInPlace(img, opts, report) {
  const big = await upscale(img, { ...opts, factor: 4 }, report);
  return {
    width: img.width,
    height: img.height,
    data: core.resize_rgb(big.width, big.height, big.data, img.width, img.height, 0),
  };
}

/** Detect faces in `img`, returned in its own pixel coordinates. */
export async function detectFaces(img, report) {
  const made = await session("detect", (p) => report({ stage: "download", model: "detect", progress: p }));
  const { ort } = made;
  const input = core.face_detect_input(img.width, img.height, img.data);
  const outputs = await made.session.run({ input: tensor(ort, input, [1, 3, 640, 640]) });
  const get = (name) => outputs[name].data;
  const json = core.face_detect_decode(
    core.face_detect_scale(img.width, img.height),
    get("cls_8"), get("obj_8"), get("bbox_8"), get("kps_8"),
    get("cls_16"), get("obj_16"), get("bbox_16"), get("kps_16"),
    get("cls_32"), get("obj_32"), get("bbox_32"), get("kps_32"),
  );
  for (const t of Object.values(outputs)) t.dispose?.();
  return JSON.parse(json);
}

/**
 * Restore every face found in `source`, pasting into `target`.
 *
 * The faces are located in the *source* frame and pasted into a target that
 * may be several times larger, which is why `ratio` exists: detecting on
 * the upscaled image would cost four times the work for landmarks that are
 * no more accurate.
 */
export async function restoreFaces(source, target, faces, opts, report) {
  const { strength = 0.8, feather = 24 } = opts;
  if (!faces.length) return target;
  const made = await session("face", (p) => report({ stage: "download", model: "face", progress: p }));
  const { ort } = made;
  const ratio = target.width / source.width;
  let current = target;
  for (let i = 0; i < faces.length; i++) {
    const flat = Float32Array.from(faces[i].landmarks.flat());
    const crop = core.face_crop(source.width, source.height, source.data, flat);
    const out = await run(made, { input: tensor(ort, crop, [1, 3, 512, 512]) });
    const data = core.face_paste(
      current.width, current.height, current.data,
      ratio, flat, out.data, feather, strength,
    );
    out.dispose?.();
    current = { width: current.width, height: current.height, data };
    report({ stage: "faces", progress: (i + 1) / faces.length, count: faces.length });
    await Promise.resolve();
  }
  return current;
}

/**
 * Colourise, keeping the original's lightness.
 *
 * The model runs at 256² rather than its full 512². Only the a and b
 * channels are taken from it, and chroma in a photograph is low-frequency —
 * it is the *lightness*, which comes from the original at full resolution,
 * that carries the detail. Halving the edge is four times less work for a
 * difference that does not survive the upsample, and at 512² this step
 * takes long enough on a phone to be the slowest thing in the app.
 */
export async function colorize(img, opts, report) {
  const { saturation = 1, size = 256 } = opts;
  const made = await session("colorize", (p) => report({ stage: "download", model: "colorize", progress: p }));
  const { ort } = made;
  const input = core.deoldify_input(img.width, img.height, img.data, size);
  const out = await run(made, { input: tensor(ort, input, [1, 3, size, size]) });
  const data = core.colorize_merge(img.width, img.height, img.data, out.data, size, saturation);
  out.dispose?.();
  report({ stage: "colorize", progress: 1 });
  return { width: img.width, height: img.height, data };
}

/** The foreground matte, as one alpha byte per pixel. */
export async function matte(img, report) {
  const made = await session("matte", (p) => report({ stage: "download", model: "matte", progress: p }));
  const { ort } = made;
  const input = core.u2net_input(img.width, img.height, img.data);
  const outputs = await made.session.run({ "input.1": tensor(ort, input, [1, 3, 320, 320]) });
  const d0 = outputs[made.session.outputNames[0]];
  const m = core.matte_from_output(d0.data, img.width, img.height);
  for (const t of Object.values(outputs)) t.dispose?.();
  report({ stage: "matte", progress: 1 });
  return m;
}

/**
 * The whole job, in the order the steps have to happen.
 *
 * Faces are detected on the input and restored *after* upscaling, because
 * GFPGAN works at a fixed 512 and pasting its output into the larger image
 * is what preserves its detail. Colourisation runs before upscaling — it
 * only decides hue, and deciding it on a smaller image costs nothing and
 * saves a large resample.
 */
/**
 * Cap the working size.
 *
 * Not a paywall in disguise — a hard ceiling on what a browser tab can
 * hold. A 4x pass on a 12 MP photo produces 192 MP, which is over half a
 * gigabyte of RGB before the canvas takes its own copy, and a phone kills
 * the tab rather than reporting anything. The default puts the *output*
 * near 40 MP, larger than any screen or an A3 print needs, and the Studio
 * says plainly when it applied.
 */
function capped(img, factor, maxOutputPixels) {
  const outPixels = img.width * img.height * factor * factor;
  if (!maxOutputPixels || outPixels <= maxOutputPixels) return null;
  const ratio = Math.sqrt(maxOutputPixels / outPixels);
  const width = Math.max(1, Math.floor(img.width * ratio));
  const height = Math.max(1, Math.floor(img.height * ratio));
  return {
    width,
    height,
    data: core.resize_rgb(img.width, img.height, img.data, width, height, 0),
  };
}

export async function process(img, opts, report) {
  const factor = opts.factor ?? 1;
  const cap = capped(img, factor, opts.maxOutputPixels ?? 40_000_000);
  if (cap) {
    report({ stage: "capped", width: cap.width, height: cap.height });
    img = cap;
  }
  const steps = {
    colorize: opts.colorize,
    // Factor 1 still runs the model: "same size, just cleaner" is a 4x pass
    // resampled back down, which is what removes noise and compression
    // artefacts without changing the dimensions.
    upscale: true,
    faces: opts.faces,
    background: opts.background !== "keep",
    sharpen: opts.sharpen > 0,
  };

  let current = img;
  if (steps.colorize) {
    current = await colorize(current, opts, report);
  }

  let faces = [];
  if (steps.faces) {
    report({ stage: "detect" });
    faces = await detectFaces(current, report);
    report({ stage: "detected", count: faces.length });
  }

  const source = current;
  if (steps.upscale) {
    current = factor > 1 ? await upscale(current, opts, report) : await enhanceInPlace(current, opts, report);
  }

  if (steps.faces && faces.length) {
    current = await restoreFaces(source, current, faces, opts, report);
  }

  if (steps.sharpen) {
    report({ stage: "sharpen" });
    current = {
      width: current.width,
      height: current.height,
      data: core.unsharp(current.width, current.height, current.data, 1.0, opts.sharpen, 2),
    };
  }

  let alpha = null;
  if (steps.background) {
    const m = await matte(current, report);
    if (opts.background === "remove") {
      alpha = m;
    } else {
      const [r, g, b] = opts.backgroundColor ?? [255, 255, 255];
      current = {
        width: current.width,
        height: current.height,
        data: core.replace_background(current.width, current.height, current.data, m, r, g, b),
      };
    }
  }

  report({ stage: "metrics" });
  const metrics = JSON.parse(
    core.quality_report(img.width, img.height, img.data, current.width, current.height, current.data),
  );

  return {
    image: current,
    alpha,
    metrics,
    faces: faces.length,
    capped: cap ? { width: cap.width, height: cap.height } : null,
  };
}

/**
 * Whether an image looks monochrome, in CIE L*a*b* — the authoritative
 * measure, reported with the result.
 *
 * `core` is deliberately not re-exported: this module only ever runs inside
 * the worker, where the wasm module has been initialised. Importing it on
 * the main thread would load a second copy and then fail on the first call
 * with an error naming a wasm-bindgen internal, which is a long way from
 * the actual mistake.
 */
export function looksMonochrome(img) {
  return core.mean_chroma(img.width, img.height, img.data) < 4;
}
