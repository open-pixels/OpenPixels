/**
 * The job options, their defaults, and the one place that turns a progress
 * message into a sentence.
 *
 * Defaults matter more here than they look. Someone arriving with a blurry
 * photo should be able to press one button and get a good result, so the
 * defaults are the settings that are right for the common case — a photo
 * from a phone or a messaging app — rather than the settings that show off
 * the most features.
 */

import { translate } from "./i18n.js";
import { MODELS } from "./engine/models.js";

export function defaults() {
  return {
    factor: 2,
    kind: "photo",
    denoise: "medium",
    faces: false,
    strength: 0.8,
    feather: 24,
    colorize: false,
    saturation: 1,
    sharpen: 0,
    background: "keep",
    backgroundColor: [255, 255, 255],
    format: "image/png",
    quality: 0.92,
  };
}

/** The suffix that goes into the saved file's name. */
export function suffix(opts) {
  const bits = [];
  if (opts.factor > 1) bits.push(`${opts.factor}x`);
  else bits.push("clean");
  if (opts.faces) bits.push("faces");
  if (opts.colorize) bits.push("colour");
  if (opts.background === "remove") bits.push("cutout");
  return `-${bits.join("-")}`;
}

export function extensionFor(format) {
  return format === "image/jpeg" ? "jpg" : format === "image/webp" ? "webp" : "png";
}

/**
 * Turn a worker progress message into a sentence.
 *
 * Kept out of the components because three of them show progress and the
 * strings must not drift between them.
 */
export function progressText(p) {
  if (!p) return "";
  const pct = (v) => Math.round((v ?? 0) * 100);
  switch (p.stage) {
    case "download":
      return translate("progress.download", {
        model: MODELS[p.model]?.label ?? p.model,
        percent: pct(p.progress),
      });
    case "upscale":
      return p.passes > 1
        ? translate("progress.upscale.pass", { pass: p.pass, passes: p.passes, percent: pct(p.progress) })
        : translate("progress.upscale", { percent: pct(p.progress) });
    case "detect":
      return translate("progress.detect");
    case "detected":
      return p.count ? translate("progress.detected", { count: p.count }) : translate("progress.detected.none");
    case "faces":
      return translate("progress.faces", { percent: pct(p.progress) });
    case "colorize":
      return translate("progress.colorize");
    case "matte":
      return translate("progress.matte");
    case "sharpen":
      return translate("progress.sharpen");
    case "metrics":
      return translate("progress.metrics");
    default:
      return "";
  }
}

/** A fraction for the progress bar, or null when the stage has no measure. */
export function progressFraction(p) {
  if (!p) return null;
  if (p.stage === "download" || p.stage === "upscale" || p.stage === "faces") return p.progress ?? null;
  return null;
}

/** Human file size, for the model list and download prompts. */
export function formatBytes(bytes) {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  if (bytes >= 1e3) return `${Math.round(bytes / 1e3)} KB`;
  return `${bytes} B`;
}

/**
 * What this run still has to download, so the UI can warn before starting
 * rather than after — a 170 MB surprise on mobile data is exactly the kind
 * of thing this product exists not to do.
 */
export function pendingDownloads(opts, cached) {
  const need = new Set();
  if (opts.factor >= 1) {
    need.add(
      opts.kind === "anime"
        ? "sr_anime"
        : opts.kind === "quality"
          ? "sr_quality"
          : opts.denoise === "strong"
            ? "sr_fast_wdn"
            : opts.denoise === "medium"
              ? "sr_fast_dn50"
              : "sr_fast",
    );
  }
  if (opts.faces) {
    need.add("detect");
    need.add("face");
  }
  if (opts.colorize) need.add("colorize");
  if (opts.background !== "keep") need.add("matte");

  const missing = [...need].filter((id) => !cached?.[id]);
  return {
    ids: missing,
    bytes: missing.reduce((sum, id) => sum + (MODELS[id]?.bytes ?? 0), 0),
  };
}
