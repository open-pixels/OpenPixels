/**
 * The model catalogue, and the cache they live in after first use.
 *
 * Served from this app's own origin rather than from upstream release URLs.
 * Three reasons, in order of how much they matter:
 *
 *  1. The product's claim is that the photo never leaves the device.
 *     Fetching weights cross-origin at run time would hand a third party a
 *     request timed to the exact moment someone opens a private photo.
 *  2. Neither upstream host commits to CORS headers, so it would work until
 *     the day it did not.
 *  3. In Cache Storage, a second visit needs the network for nothing —
 *     which is the difference between "works offline" as a bullet point and
 *     as a fact.
 *
 * `scripts/fetch-models.sh` fetches and checksums them at build time; the
 * checksums and licences are in MODELS.md.
 */

import { baseUrl } from "./ort.js";

const CACHE = "openpixels-models-v1";

/** Everything the app can download, with what a user needs to decide. */
export const MODELS = {
  sr_fast: {
    file: "realesr_general_x4v3.onnx",
    bytes: 4_866_422,
    scale: 4,
    label: "Fast",
    note: "Good on photos and screenshots. The default.",
  },
  sr_fast_dn50: {
    file: "realesr_general_x4v3_dn50.onnx",
    bytes: 4_866_422,
    scale: 4,
    label: "Fast, medium denoise",
  },
  sr_fast_wdn: {
    file: "realesr_general_wdn_x4v3.onnx",
    bytes: 4_866_422,
    scale: 4,
    label: "Fast, strong denoise",
  },
  sr_quality: {
    file: "realesrgan_x4plus.onnx",
    bytes: 67_051_644,
    scale: 4,
    label: "Detailed",
    note: "Sharper on real photographs. Slower, and a larger download.",
  },
  sr_anime: {
    file: "realesrgan_x4plus_anime_6b.onnx",
    bytes: 17_939_969,
    scale: 4,
    label: "Drawings and anime",
    note: "For flat colour and line art. Softens photographs.",
  },
  face: {
    file: "gfpgan_1.4_fp16.onnx",
    bytes: 170_261_734,
    scale: 1,
    label: "Face restoration",
    note: "Rebuilds blurred faces. A large download, and slow without a GPU.",
  },
  colorize: {
    file: "deoldify_artistic.onnx",
    bytes: 255_044_725,
    scale: 1,
    label: "Colourise",
    note: "Adds colour to a black-and-white photo. The largest download here.",
  },
  matte: {
    file: "u2netp.onnx",
    bytes: 4_574_861,
    scale: 1,
    label: "Background removal",
  },
  detect: {
    file: "face_detection_yunet_2023mar.onnx",
    bytes: 232_589,
    scale: 1,
    label: "Face detection",
    note: "Finds faces so the face restorer knows where to work.",
  },
};

/** Which model a super-resolution job should use. */
export function srModel({ kind = "photo", denoise = "off" } = {}) {
  if (kind === "anime") return "sr_anime";
  if (kind === "quality") return "sr_quality";
  if (denoise === "strong") return "sr_fast_wdn";
  if (denoise === "medium") return "sr_fast_dn50";
  return "sr_fast";
}

/**
 * Where model files are served from.
 *
 * The web app serves its own; the extension cannot ship hundreds of
 * megabytes through a store review, so it points here. Both go through the
 * same cache and the same progress reporting.
 */
let origin = null;
export function setModelOrigin(url) {
  origin = url;
}

function modelUrl(file) {
  const base = origin ?? new URL("./models/", baseUrl()).href;
  return new URL(file, base.endsWith("/") ? base : base + "/").href;
}

async function openCache() {
  if (typeof caches === "undefined") return null;
  return caches.open(CACHE).catch(() => null);
}

/**
 * Fetch a model, preferring the cache. `onProgress(fraction)` is called as
 * it streams — a 170 MB download needs a real progress bar, not a spinner
 * that looks identical to a hang.
 */
export async function fetchModel(id, onProgress) {
  const spec = MODELS[id];
  if (!spec) throw new Error(`unknown model ${id}`);
  const url = modelUrl(spec.file);

  const cache = await openCache();
  const hit = cache && (await cache.match(url));
  if (hit) {
    onProgress?.(1);
    return new Uint8Array(await hit.arrayBuffer());
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`${spec.file}: ${res.status} ${res.statusText}`);
  // Clone before consuming: a body reads once, and we want both the bytes
  // now and a cache entry for next time.
  if (cache) cache.put(url, res.clone()).catch(() => {});

  const total = Number(res.headers.get("content-length")) || spec.bytes;
  if (!res.body) {
    onProgress?.(1);
    return new Uint8Array(await res.arrayBuffer());
  }

  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.min(1, received / total));
  }
  const out = new Uint8Array(received);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  onProgress?.(1);
  return out;
}

/** Which models are already on this device. */
export async function cachedModels() {
  const cache = await openCache();
  if (!cache) return {};
  const out = {};
  for (const [id, spec] of Object.entries(MODELS)) {
    out[id] = Boolean(await cache.match(modelUrl(spec.file)));
  }
  return out;
}

/** Delete one model, or every model, from this device. */
export async function forgetModel(id) {
  const cache = await openCache();
  if (!cache) return;
  const ids = id ? [id] : Object.keys(MODELS);
  for (const one of ids) {
    await cache.delete(modelUrl(MODELS[one].file)).catch(() => {});
  }
}
