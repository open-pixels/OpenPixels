// The app icons, as plain pixel maths — no image library, no design tool.
//
// A rounded square in the OpenApps ink, with a four-point sparkle: the
// "make this better" glyph the Enhance button also uses, so the tab icon
// and the primary action say the same thing. Output is committed; this is
// not part of the normal build.
import zlib from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outDir = join(dirname(dirname(fileURLToPath(import.meta.url))), "public", "icons");
mkdirSync(outDir, { recursive: true });

const BG = [17, 17, 17, 255];
const FG = [255, 255, 255, 255];
const CLEAR = [0, 0, 0, 0];

/** A four-point star: |x|^k + |y|^k <= r^k with k < 1 pinches the waist. */
function sparkle(dx, dy, r) {
  const k = 0.62;
  return Math.pow(Math.abs(dx), k) + Math.pow(Math.abs(dy), k) <= Math.pow(r, k);
}

function drawIcon(size, { maskable = false } = {}) {
  const data = new Uint8Array(size * size * 4);
  const radius = maskable ? size / 2 : Math.round(size * 0.22);
  // A maskable icon is cropped to a circle inscribed in the safe zone, so
  // the artwork has to sit well inside the square or the crop eats it.
  const inset = maskable ? size * 0.1 : 0;

  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const off = (y * size + x) * 4;
    data.set(c, off);
  };

  const inRounded = (x, y) => {
    const lo = inset;
    const hi = size - 1 - inset;
    if (x < lo || y < lo || x > hi || y > hi) return false;
    const side = hi - lo;
    const r = Math.min(radius, side / 2);
    const cx = x < lo + r ? lo + r : x > hi - r ? hi - r : null;
    const cy = y < lo + r ? lo + r : y > hi - r ? hi - r : null;
    if (cx === null || cy === null) return true;
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) set(x, y, inRounded(x, y) ? BG : CLEAR);
  }

  // A large sparkle just off centre, and a small one up and to the right —
  // the same arrangement as the Lucide glyph in the UI.
  const c = size / 2;
  const big = size * 0.29;
  const small = size * 0.1;
  const sx = c + size * 0.19;
  const sy = c - size * 0.22;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (!inRounded(x, y)) continue;
      const px = x + 0.5;
      const py = y + 0.5;
      if (sparkle(px - (c - size * 0.05), py - (c + size * 0.03), big) || sparkle(px - sx, py - sy, small)) {
        set(x, y, FG);
      }
    }
  }
  return data;
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    Buffer.from(rgba.buffer, y * size * 4, size * 4).copy(raw, y * (size * 4 + 1) + 1);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const tb = Buffer.concat([Buffer.from(type, "ascii"), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32 ? zlib.crc32(tb) >>> 0 : crc32(tb));
    return Buffer.concat([len, tb, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// Node before 20.15 has no zlib.crc32.
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * An ICO holding several sizes.
 *
 * This is the file a browser fetches from the site root when it does not
 * read the `<link>` tags, and the one several link-preview crawlers fetch
 * without parsing the HTML at all. Shipping only an SVG is why a tab comes
 * up blank — and on this app it was worse than blank: the SPA fallback
 * answered `/favicon.ico` with `200 text/html`, handing every one of those
 * clients an HTML document labelled as an icon.
 *
 * The entries are PNGs, which every ICO reader since Vista accepts and
 * which keeps this file free of a second encoder. Sizes are one byte, and
 * 256 is encoded as 0; nothing else about the container is subtle.
 */
function ico(sizes) {
  const images = sizes.map((size) => ({ size, body: png(size, drawIcon(size)) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = [];
  for (const { size, body } of images) {
    const e = Buffer.alloc(16);
    e[0] = size >= 256 ? 0 : size;
    e[1] = size >= 256 ? 0 : size;
    e[2] = 0; // palette
    e[3] = 0; // reserved
    e.writeUInt16LE(1, 4); // colour planes
    e.writeUInt16LE(32, 6); // bits per pixel
    e.writeUInt32BE(0, 8);
    e.writeUInt32LE(body.length, 8);
    e.writeUInt32LE(offset, 12);
    entries.push(e);
    offset += body.length;
  }
  return Buffer.concat([header, ...entries, ...images.map((i) => i.body)]);
}

for (const [name, size, opts] of [
  ["icon-192.png", 192, {}],
  ["icon-512.png", 512, {}],
  ["icon-maskable-512.png", 512, { maskable: true }],
  ["apple-touch-icon.png", 180, {}],
  ["icon-180.png", 180, {}],
  ["icon-128.png", 128, {}],
  ["icon-48.png", 48, {}],
  ["icon-32.png", 32, {}],
  ["icon-16.png", 16, {}],
]) {
  writeFileSync(join(outDir, name), png(size, drawIcon(size, opts)));
  console.log(`  ${name}`);
}

// At the site root, not under icons/: that is the only path a client
// looking for it will try.
writeFileSync(join(dirname(outDir), "favicon.ico"), ico([16, 32, 48]));
console.log("  ../favicon.ico");

// The favicon, as SVG, so it stays crisp at any size a browser asks for.
writeFileSync(
  join(outDir, "favicon.svg"),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
  <rect width="24" height="24" rx="5.3" fill="#111"/>
  <path d="M11 5.2l1.85 4.45L17.3 11.5l-4.45 1.85L11 17.8l-1.85-4.45L4.7 11.5l4.45-1.85L11 5.2z" fill="#fff"/>
  <path d="M17.9 15.1l.66 1.57 1.57.66-1.57.66-.66 1.57-.66-1.57-1.57-.66 1.57-.66.66-1.57z" fill="#fff"/>
</svg>
`,
);
console.log("  favicon.svg");
