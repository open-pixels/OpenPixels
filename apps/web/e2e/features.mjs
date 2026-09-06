/**
 * Exercises the features the main smoke test does not: face restoration,
 * colourisation, background removal, 8x, batch and the ZIP.
 *
 * Kept separate because it downloads ~300 MB of weights and runs several
 * minutes of inference — the fast smoke test should stay fast enough to run
 * on every change.
 *
 *   node e2e/features.mjs [--headed]
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "..", "dist");
const OUT = join(here, "output-features");
const PORT = 8096;
const headed = process.argv.includes("--headed");

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".onnx": "application/octet-stream",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg",
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
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Set the options, run, and return the reported measurements. */
async function run(page, configure, { timeout = 900_000 } = {}) {
  await configure(page);
  const button = page.getByRole("button", { name: /^(Enhance|Apply changes)$/ });
  await button.click();
  await page.locator('[role="slider"]').waitFor({ timeout });
  await page.waitForTimeout(400);
  const text = await page.locator("main").innerText();
  return text;
}

async function main() {
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ channel: "chromium", headless: !headed });
  const page = await browser.newPage({ viewport: { width: 460, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const photo = await readFile(join(here, "fixtures", "portrait.jpg"));
  const grey = await readFile(join(here, "fixtures", "portrait-grey.jpg"));

  const pick = async (buffer, name) => {
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(500);
    await page.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', {
      name, mimeType: "image/jpeg", buffer,
    });
    await page.waitForTimeout(1000);
  };

  try {
    // --- face restoration, the largest model and the hardest paste-back.
    await pick(photo, "portrait.jpg");
    let text = await run(page, async (p) => {
      await p.getByText("Rebuild faces", { exact: true }).click();
      await p.waitForTimeout(200);
    });
    check("face restoration completes", /sharper|as sharp/i.test(text));
    await page.screenshot({ path: join(OUT, "1-faces.png"), fullPage: true });

    // --- colourisation of a genuinely monochrome photo.
    await pick(grey, "portrait-grey.jpg");
    const hint = await page.locator("main").innerText();
    check("a monochrome photo is recognised", /black-and-white/i.test(hint));
    text = await run(page, async (p) => {
      await p.getByText("Add colour", { exact: true }).click();
      await p.waitForTimeout(200);
    });
    check("colourisation completes", /sharper|as sharp/i.test(text));
    await page.screenshot({ path: join(OUT, "2-colour.png"), fullPage: true });

    // Colour actually arrived: sample the result image, not the report.
    const colourful = await page.evaluate(async () => {
      const img = document.querySelector('[role="slider"] img.base');
      const bmp = await createImageBitmap(await (await fetch(img.src)).blob());
      const c = new OffscreenCanvas(64, 64);
      const ctx = c.getContext("2d");
      ctx.drawImage(bmp, 0, 0, 64, 64);
      const { data } = ctx.getImageData(0, 0, 64, 64);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) {
        sum += Math.max(data[i], data[i + 1], data[i + 2]) - Math.min(data[i], data[i + 1], data[i + 2]);
      }
      return sum / (64 * 64);
    });
    check("the colourised result actually has colour", colourful > 8, `mean chroma ${colourful.toFixed(1)}`);

    // --- background removal, which produces alpha and must save as PNG.
    await pick(photo, "portrait.jpg");
    text = await run(page, async (p) => {
      await p.getByRole("button", { name: /More options/i }).click();
      await p.waitForTimeout(200);
      await p.getByText("Remove it", { exact: true }).click();
      await p.waitForTimeout(200);
    });
    check("background removal completes", /sharper|as sharp/i.test(text));
    const download = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /Save the photo/i }).click();
    const file = await download;
    await file.saveAs(join(OUT, "cutout.png"));
    check("a cut-out saves as PNG", file.suggestedFilename().endsWith(".png"), file.suggestedFilename());
    await page.screenshot({ path: join(OUT, "3-cutout.png"), fullPage: true });

    // --- 8x, which is two passes of the model.
    await pick(photo, "portrait.jpg");
    text = await run(page, async (p) => {
      await p.getByText("8×", { exact: true }).click();
      await p.waitForTimeout(200);
    });
    const size = text.match(/(\d+) × (\d+), from (\d+) × (\d+)/);
    check("8x produces an 8x image", size && Number(size[1]) === Number(size[3]) * 8, size ? `${size[1]}x${size[2]}` : "no size line");
    await page.screenshot({ path: join(OUT, "4-eight.png"), fullPage: true });

    // --- batch, the ZIP and the CSV.
    await page.goto(`http://localhost:${PORT}/#/batch`);
    await page.waitForTimeout(600);
    await page.setInputFiles('input[type="file"][multiple]', [
      { name: "one.jpg", mimeType: "image/jpeg", buffer: photo },
      { name: "two.jpg", mimeType: "image/jpeg", buffer: photo },
      { name: "three.jpg", mimeType: "image/jpeg", buffer: photo },
    ]);
    await page.waitForTimeout(400);
    await page.getByRole("button", { name: /^Start$/ }).click();
    await page.getByText("3 of 3 done").waitFor({ timeout: 600_000 });
    check("a batch of three completes", true);

    const zip = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /Download all as a ZIP/i }).click();
    await (await zip).saveAs(join(OUT, "batch.zip"));
    const csv = page.waitForEvent("download", { timeout: 60_000 });
    await page.getByRole("button", { name: /Download the measurements/i }).click();
    await (await csv).saveAs(join(OUT, "batch.csv"));
    check("the batch ZIP and CSV download", true);
    await page.screenshot({ path: join(OUT, "5-batch.png"), fullPage: true });

    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
  } finally {
    if (!headed) await browser.close();
    server.close();
  }

  await writeFile(join(OUT, "report.json"), JSON.stringify(checks, null, 2));
  const bad = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - bad.length}/${checks.length} passed. Output in e2e/output-features/`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
