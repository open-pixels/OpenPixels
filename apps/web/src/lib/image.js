/**
 * Getting pixels in and out of the browser.
 *
 * `createImageBitmap` is the whole decode path: it handles every format the
 * browser knows, applies EXIF orientation, and does it off the main thread.
 * A phone photo is routinely 12 MP and portrait-flagged; doing this by hand
 * would mean an EXIF parser and a rotation pass in JavaScript.
 */

/** Decode a File or Blob into raw RGB, honouring EXIF orientation. */
export async function decode(file) {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bitmap, 0, 0);
    const { data } = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, rgba: data };
  } finally {
    bitmap.close();
  }
}

/** An object URL showing an RGB buffer, for an `<img>`. */
export async function toUrl(img, alpha = null) {
  const blob = await toBlob(img, alpha, "image/png");
  return URL.createObjectURL(blob);
}

/**
 * Encode. PNG is the default because the point of the tool is not to throw
 * detail away again; JPEG and WebP are there for someone who has to email
 * the result.
 */
export async function toBlob(img, alpha, type = "image/png", quality = 0.92) {
  const canvas = new OffscreenCanvas(img.width, img.height);
  const ctx = canvas.getContext("2d");
  const rgba = new Uint8ClampedArray(img.width * img.height * 4);
  for (let i = 0, j = 0; i < img.data.length; i += 3, j += 4) {
    rgba[j] = img.data[i];
    rgba[j + 1] = img.data[i + 1];
    rgba[j + 2] = img.data[i + 2];
    rgba[j + 3] = alpha ? alpha[j / 4] : 255;
  }
  ctx.putImageData(new ImageData(rgba, img.width, img.height), 0, 0);
  return canvas.convertToBlob({ type, quality });
}

/**
 * Whether a decoded image looks monochrome, for the "you could colourise
 * this" hint.
 *
 * Deliberately *not* the Rust `mean_chroma`, which works in CIE L*a*b* and
 * is the number the pipeline reports. Running that here would mean loading
 * a second copy of the wasm module on the main thread — the thing the
 * worker exists to avoid — for a hint. Max-minus-min per pixel over a
 * subsample answers "is there any colour in this" well enough to decide
 * whether to show one line of text, and the authoritative value still comes
 * back with the result.
 */
export function looksMonochrome(decoded) {
  const n = decoded.width * decoded.height;
  const step = Math.max(1, Math.floor(n / 20_000));
  let sum = 0;
  let count = 0;
  for (let i = 0; i < n; i += step) {
    const j = i * 4;
    const r = decoded.rgba[j];
    const g = decoded.rgba[j + 1];
    const b = decoded.rgba[j + 2];
    sum += Math.max(r, g, b) - Math.min(r, g, b);
    count++;
  }
  return count > 0 && sum / count < 12;
}

/** RGBA (from `decode`) to the packed RGB the engine takes. */
export function toRgb(decoded) {
  const n = decoded.width * decoded.height;
  const out = new Uint8Array(n * 3);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    out[i * 3] = decoded.rgba[j];
    out[i * 3 + 1] = decoded.rgba[j + 1];
    out[i * 3 + 2] = decoded.rgba[j + 2];
  }
  return { width: decoded.width, height: decoded.height, data: out };
}

/** A side-by-side before/after PNG — the thing people post. */
export async function comparisonSheet(before, after, { gap = 16, label = true } = {}) {
  const h = 1024;
  const bw = Math.round((before.width / before.height) * h);
  const aw = Math.round((after.width / after.height) * h);
  const bar = label ? 56 : 0;
  const canvas = new OffscreenCanvas(bw + gap + aw, h + bar);
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const draw = async (img, x, w) => {
    const blob = await toBlob(img, null, "image/png");
    const bmp = await createImageBitmap(blob);
    ctx.drawImage(bmp, x, 0, w, h);
    bmp.close();
  };
  await draw(before, 0, bw);
  await draw(after, bw + gap, aw);

  if (label) {
    ctx.fillStyle = "#111111";
    ctx.font = "500 28px system-ui, sans-serif";
    ctx.textBaseline = "middle";
    ctx.fillText("Before", 8, h + bar / 2);
    ctx.fillText("After", bw + gap + 8, h + bar / 2);
  }
  return canvas.convertToBlob({ type: "image/png" });
}
