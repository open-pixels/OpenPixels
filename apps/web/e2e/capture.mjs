/**
 * Screenshots of the built app, for the test guide.
 *
 *   node e2e/capture.mjs [outdir] [--headed]
 *
 * Against `dist/`, never the dev server: a guide illustrated with a dev
 * build documents something nobody can install. Every image here is the
 * real app doing real inference on a real photo — there are no mock-ups,
 * and the numbers in the captions are the ones the app printed at the
 * moment of the shot.
 *
 * Waits are on content, never on the clock. A fixed `waitForTimeout` is how
 * a capture run ends up photographing a spinner on a slower machine.
 */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "..", "dist");
const OUT = process.argv[2] && !process.argv[2].startsWith("--")
  ? process.argv[2]
  : join(here, "..", "..", "..", "docs", "screenshots");
const headed = process.argv.includes("--headed");
let PORT = Number(process.env.E2E_PORT ?? 0);

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".onnx": "application/octet-stream",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2",
  ".jpg": "image/jpeg", ".ico": "image/x-icon",
};

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname === "/" || !existsSync(path)) {
      if (existsSync(join(path, "index.html"))) path = join(path, "index.html");
      else { res.writeHead(404).end("not found"); return; }
    }
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(await readFile(path));
  });
  return new Promise((r) => server.listen(PORT, () => {
    PORT = server.address().port;
    r(server);
  }));
}

const shots = [];
async function shot(page, name, note) {
  const path = join(OUT, name);
  // Back to the top first. The header is `position: sticky`, and a
  // full-page screenshot taken while scrolled paints it wherever it is
  // sitting in the viewport — which lands it halfway down the image,
  // across whatever it happens to overlap, looking exactly like a layout
  // bug in the app. Clicking a control is enough to scroll the page, so
  // this cannot be done once at the start.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForFunction(() => window.scrollY === 0);
  await page.screenshot({ path, fullPage: true });
  shots.push({ name, note });
  console.log(`  ${name}  — ${note}`);
}

/** Load a photo into the studio, from the home screen. */
async function pick(page, buffer, name) {
  await page.goto(`http://localhost:${PORT}/`);
  await page.getByRole("heading", { level: 1 }).waitFor();
  await page.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', {
    name, mimeType: "image/jpeg", buffer,
  });
  await page.locator(".preview img").waitFor();
}

/** Enhance, and wait for the compare slider that only exists once it is done. */
async function enhance(page, configure = async () => {}) {
  await configure(page);
  await page.getByRole("button", { name: /^(Enhance|Apply changes)$/ }).click();
  await page.locator('[role="slider"]').waitFor({ timeout: 900_000 });
  // The measurements land a frame after the slider; wait for the text, not
  // for a duration.
  await page.waitForFunction(() => /sharper|as sharp/i.test(document.querySelector("main")?.innerText ?? ""));
}

/** Whatever the quality panel is claiming right now, for the caption. */
const claim = (page) =>
  page.evaluate(() => {
    const m = document.querySelector("main")?.innerText ?? "";
    return (m.match(/[^\n]*(?:sharper|as sharp)[^\n]*/i) ?? [""])[0].trim();
  });

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("capture: dist/index.html missing — run `npm run build` first");
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ channel: "chromium", headless: !headed });

  const photo = await readFile(join(here, "fixtures", "portrait.jpg"));
  const grey = await readFile(join(here, "fixtures", "portrait-grey.jpg"));

  // The app is mobile-first — a 720px reading column, by decision, not by
  // accident — so a desktop context shows it centred, which is what a
  // desktop visitor actually sees.
  const desktop = await browser.newContext({
    viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: "light",
  });
  const dark = await browser.newContext({
    viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: "dark",
  });
  const phone = await browser.newContext({
    viewport: { width: 400, height: 860 }, deviceScaleFactor: 3, colorScheme: "light",
    isMobile: true, hasTouch: true,
  });

  const errors = [];
  for (const c of [desktop, dark, phone]) {
    c.on("weberror", (e) => errors.push(String(e.error())));
  }

  try {
    // --- the empty state, which is the first thing anyone sees ----------
    const page = await desktop.newPage();
    await page.goto(`http://localhost:${PORT}/`);
    await page.getByRole("heading", { level: 1 }).waitFor();
    await shot(page, "01-empty.png", "the landing state: one control, and the claim");

    const dpage = await dark.newPage();
    await dpage.goto(`http://localhost:${PORT}/`);
    await dpage.getByRole("heading", { level: 1 }).waitFor();
    await shot(dpage, "02-empty-dark.png", "the same screen in the dark theme");

    // --- a photo, and the options before anything has run ---------------
    await pick(page, photo, "portrait.jpg");
    await shot(page, "03-studio.png", "a photo loaded; every option is on this one screen");

    // --- the result, which is the product ------------------------------
    await enhance(page);
    const upscale = await claim(page);
    await shot(page, "04-result.png", `2x upscale — ${upscale}`);

    await page.getByRole("button", { name: /The numbers/i }).click();
    await page.locator("table").waitFor();
    const table = (await page.locator("table").innerText()).replace(/\s+/g, " ").trim();
    await shot(page, "05-numbers.png", `the measurements behind the claim — ${table}`);

    // --- the same job in the dark theme --------------------------------
    await pick(dpage, photo, "portrait.jpg");
    await enhance(dpage);
    await shot(dpage, "06-result-dark.png", `the result in the dark theme — ${await claim(dpage)}`);

    // --- a monochrome photo, which the app recognises itself ------------
    await pick(page, grey, "portrait-grey.jpg");
    const hint = await page.locator("main").innerText();
    await shot(page, "07-monochrome.png",
      `a black-and-white photo, detected from its chroma: ${/black-and-white/i.test(hint) ? "colourisation offered" : "NOT offered"}`);

    await enhance(page, async (p) => { await p.getByText("Add colour", { exact: true }).click(); });
    await shot(page, "08-colourised.png", `colourised — ${await claim(page)}`);

    // --- at scale: a batch, the most persuasive shot there is -----------
    // Its own context, so it shows the *default* settings. Sharing the
    // desktop one carries the colourisation just switched on above over
    // into the batch panel through persisted settings, and the shot then
    // documents a configuration nobody chose.
    const batch = await browser.newContext({
      viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, colorScheme: "light",
    });
    batch.on("weberror", (e) => errors.push(String(e.error())));
    const bpage = await batch.newPage();
    await bpage.goto(`http://localhost:${PORT}/#/batch`);
    await bpage.locator('input[type="file"][multiple]').waitFor();
    const many = ["one", "two", "three", "four", "five", "six"].map((n) => ({
      name: `${n}.jpg`, mimeType: "image/jpeg", buffer: photo,
    }));
    await bpage.setInputFiles('input[type="file"][multiple]', many);
    await bpage.getByRole("button", { name: /^Start$/ }).click();
    await bpage.getByText("6 of 6 done").waitFor({ timeout: 1_800_000 });
    await shot(bpage, "09-batch.png", "six photos in one pass, each with its own measurements");

    // --- the pages that carry the claims -------------------------------
    await page.goto(`http://localhost:${PORT}/#/models`);
    await page.waitForFunction(() => document.querySelectorAll("main li").length === 9);
    await shot(page, "10-models.png", "all nine models, with licence and checksum, downloadable");

    await page.goto(`http://localhost:${PORT}/#/about`);
    await page.waitForFunction(() => /no version that costs/i.test(document.querySelector("main")?.innerText ?? ""));
    await shot(page, "11-about.png", "the pricing page, which states there is no paid tier");

    await page.goto(`http://localhost:${PORT}/#/account`);
    await page.waitForFunction(() => document.querySelector("openapps-login") !== null);
    await page.waitForTimeout(600); // the custom element's own fonts
    await shot(page, "12-account.png", "signing in is optional and gates nothing");

    // --- the phone, which is the primary target -------------------------
    const ppage = await phone.newPage();
    await pick(ppage, photo, "portrait.jpg");
    await shot(ppage, "13-phone-studio.png", "the same screen at 400px, the viewport this was designed for");
    await enhance(ppage);
    await shot(ppage, "14-phone-result.png", `a real upscale on a phone viewport — ${await claim(ppage)}`);
  } finally {
    if (!headed) await browser.close();
    server.close();
  }

  await writeFile(join(OUT, "captions.json"), JSON.stringify(shots, null, 2));
  console.log(`\n${shots.length} screenshots in ${OUT}`);
  if (errors.length) {
    console.error(`\n${errors.length} page error(s):`);
    for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
