/** Saving files, and the ZIP a batch produces. */

export function save(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; a
  // grace period is enough and the blob is freed either way.
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** `photo.jpg` + `-2x` + `png` -> `photo-2x.png`. */
export function outputName(original, suffix, ext) {
  const stem = (original ?? "image").replace(/\.[^./\\]+$/, "") || "image";
  return `${stem}${suffix}.${ext}`;
}

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A ZIP file, stored (uncompressed).
 *
 * Written out by hand rather than pulled from a library: the contents are
 * PNGs and JPEGs, which do not compress further, so deflate would spend
 * seconds of a phone's CPU to save nothing. Stored entries are a few dozen
 * lines and no dependency.
 *
 * Zip64 is not implemented — a batch above 4 GB is beyond what a browser
 * tab can assemble anyway, and `zipFiles` refuses rather than writing a
 * corrupt archive.
 */
export async function zipFiles(entries) {
  const encoder = new TextEncoder();
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const { name, blob } of entries) {
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await blob.arrayBuffer());
    const crc = crc32(data);

    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true); // version needed
    local.setUint16(6, 0x0800, true); // UTF-8 names
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, 0, true); // time
    local.setUint16(12, 0x21, true); // date (1996-01-01, fixed: reproducible)
    local.setUint32(14, crc, true);
    local.setUint32(18, data.length, true);
    local.setUint32(22, data.length, true);
    local.setUint16(26, nameBytes.length, true);
    local.setUint16(28, 0, true);

    chunks.push(new Uint8Array(local.buffer), nameBytes, data);
    central.push({ nameBytes, crc, size: data.length, offset });
    offset += 30 + nameBytes.length + data.length;
    if (offset > 0xfffffffe) throw new Error("too much data for a ZIP file — download in smaller batches");
  }

  const dirStart = offset;
  for (const e of central) {
    const h = new DataView(new ArrayBuffer(46));
    h.setUint32(0, 0x02014b50, true);
    h.setUint16(4, 20, true);
    h.setUint16(6, 20, true);
    h.setUint16(8, 0x0800, true);
    h.setUint16(10, 0, true);
    h.setUint16(12, 0, true);
    h.setUint16(14, 0x21, true);
    h.setUint32(16, e.crc, true);
    h.setUint32(20, e.size, true);
    h.setUint32(24, e.size, true);
    h.setUint16(28, e.nameBytes.length, true);
    h.setUint32(42, e.offset, true);
    chunks.push(new Uint8Array(h.buffer), e.nameBytes);
    offset += 46 + e.nameBytes.length;
  }

  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, central.length, true);
  end.setUint16(10, central.length, true);
  end.setUint32(12, offset - dirStart, true);
  end.setUint32(16, dirStart, true);
  chunks.push(new Uint8Array(end.buffer));

  return new Blob(chunks, { type: "application/zip" });
}

/** A CSV of what a batch did, one row per image. */
export function metricsCsv(rows) {
  const head = [
    "file", "input_width", "input_height", "output_width", "output_height",
    "psnr_db", "ssim", "sharpness_before", "sharpness_after", "noise_before", "noise_after",
  ];
  const escape = (v) => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const lines = [head.join(",")];
  for (const r of rows) {
    const m = r.metrics ?? {};
    lines.push([
      escape(r.name),
      m.input_width ?? "", m.input_height ?? "", m.output_width ?? "", m.output_height ?? "",
      m.psnr == null ? "" : m.psnr.toFixed(2),
      m.ssim == null ? "" : m.ssim.toFixed(4),
      m.sharpness_before == null ? "" : m.sharpness_before.toFixed(2),
      m.sharpness_after == null ? "" : m.sharpness_after.toFixed(2),
      m.noise_before == null ? "" : m.noise_before.toFixed(3),
      m.noise_after == null ? "" : m.noise_after.toFixed(3),
    ].join(","));
  }
  return new Blob([lines.join("\n") + "\n"], { type: "text/csv" });
}
