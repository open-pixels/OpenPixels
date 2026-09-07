// The link-preview card for app.openpixels.app — 1200x630, exactly.
//
// This is the product's face in every chat app, and the app origin shipped
// without one: pasting the link gave a bare URL, and on Telegram a missing
// og:image usually takes the description down with it, so the two symptoms
// arrive together and read as one bug.
//
// Icons are pixel maths (generate-icons.mjs). A card is type, and type from
// pixel maths is a bitmap font that looks like 1998 — so this authors HTML
// and photographs it with the Playwright that is already a dev dependency
// for the e2e suite. Everything is embedded as a data URI: `setContent`
// renders on about:blank, where a `file://` stylesheet, font or image does
// not load, and the card comes out unstyled in Times on white looking
// exactly like a broken build.
//
//   node scripts/make-og-image.mjs
//
// Output is committed; this is not part of the normal build.
import { chromium } from "playwright";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const web = dirname(dirname(fileURLToPath(import.meta.url)));
const b64 = (p) => readFileSync(p).toString("base64");
const font = (f) => `url(data:font/woff2;base64,${b64(join(web, "src/vendor/openapps/fonts", f))}) format("woff2")`;

// The before and after are the pair the marketing site's own slider uses:
// a real run of this product, before and after, at the same size.
//
// Not the e2e fixture, which is a photograph of a real and identifiable
// person. That is fine as a test input and wrong as marketing metadata —
// this card is attached to every paste of the link in every chat app, the
// "after" is a model's reconstruction of that person's face, and the README
// is explicit that reworking real faces is the thing this product declines
// to do. The site's synthetic scene makes the same point about sharpness
// and belongs to us.
const before = join(web, "../../website/before.jpg");
const after = join(web, "../../website/after.jpg");
for (const f of [before, after]) {
  try {
    readFileSync(f);
  } catch {
    console.error(`make-og-image: ${f} missing`);
    process.exit(1);
  }
}

const html = `<!doctype html><meta charset="utf-8"><style>
  @font-face { font-family: "Geist"; font-weight: 400; src: ${font("Geist-Regular.woff2")}; }
  @font-face { font-family: "Geist"; font-weight: 500; src: ${font("Geist-Medium.woff2")}; }
  @font-face { font-family: "Geist Mono"; font-weight: 400; src: ${font("GeistMono-Regular.woff2")}; }
  * { margin: 0; box-sizing: border-box; }
  body { width: 1200px; height: 630px; display: flex; background: #0e0f11; color: #f4f4f5;
         font-family: "Geist", system-ui, sans-serif; overflow: hidden; }
  .left { flex: 1 1 0; padding: 64px 0 64px 72px; display: flex; flex-direction: column; justify-content: center; gap: 26px; }
  .brand { display: flex; align-items: center; gap: 14px; }
  .brand svg { display: block; }
  .word { font-size: 34px; font-weight: 500; letter-spacing: -0.01em; }
  .word .op { color: #8b8d93; }
  h1 { font-size: 62px; line-height: 1.04; font-weight: 500; letter-spacing: -0.03em; max-width: 13ch; }
  h1 em { font-style: normal; color: #f2a93b; }
  p { font-size: 25px; line-height: 1.45; color: #a9abb2; max-width: 24ch; }
  .strip { display: flex; gap: 12px; font-family: "Geist Mono", ui-monospace, monospace;
           font-size: 17px; color: #8b8d93; }
  .strip span { border: 1px solid #26282c; border-radius: 999px; padding: 7px 16px; }
  .right { position: relative; flex: 0 0 470px; }
  .right img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
  .right .b { clip-path: inset(0 50% 0 0); filter: blur(0.4px); }
  .seam { position: absolute; top: 0; bottom: 0; left: 50%; width: 2px; background: #f2a93b; }
  .tag { position: absolute; bottom: 22px; font-family: "Geist Mono", ui-monospace, monospace;
         font-size: 15px; letter-spacing: 0.08em; text-transform: uppercase;
         background: rgba(14,15,17,.72); padding: 6px 12px; border-radius: 6px; }
  /* Against the seam, not the panel edges: the left edge is under the
     fade, and the scene has fine caption text along the bottom that the
     tag landed on there. */
  .tag.l { right: 52%; color: #a9abb2; } .tag.r { left: 52%; color: #f2a93b; }
  .fade { position: absolute; inset: 0 auto 0 0; width: 64px;
          background: linear-gradient(to right, #0e0f11, rgba(14,15,17,0)); }
</style>
<div class="left">
  <div class="brand">
    <svg viewBox="0 0 24 24" width="38" height="38">
      <rect width="24" height="24" rx="5.3" fill="#f4f4f5"/>
      <path d="M11 5.2l1.85 4.45L17.3 11.5l-4.45 1.85L11 17.8l-1.85-4.45L4.7 11.5l4.45-1.85L11 5.2z" fill="#0e0f11"/>
      <path d="M17.9 15.1l.66 1.57 1.57.66-1.57.66-.66 1.57-.66-1.57-1.57-.66 1.57-.66.66-1.57z" fill="#0e0f11"/>
    </svg>
    <div class="word"><span class="op">Open</span>Pixels</div>
  </div>
  <h1>Make a blurry photo <em>sharp</em>.</h1>
  <p>Upscale, denoise, restore faces and colourise — in your browser.</p>
  <div class="strip"><span>nothing uploaded</span><span>no account</span><span>free</span></div>
</div>
<div class="right">
  <img src="data:image/jpeg;base64,${b64(after)}" alt="">
  <img class="b" src="data:image/jpeg;base64,${b64(before)}" alt="">
  <div class="seam"></div>
  <div class="fade"></div>
  <div class="tag l">before</div><div class="tag r">after</div>
</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
await page.setContent(html);
await page.evaluate(() => document.fonts.ready);
const out = join(web, "public", "og-image.png");
await page.screenshot({ path: out });
await browser.close();

const size = readFileSync(out).length;
console.log(`  public/og-image.png  1200x630, ${(size / 1024).toFixed(0)} KB`);
if (size > 900_000) console.warn("  warning: some crawlers refuse an image over ~1 MB");
