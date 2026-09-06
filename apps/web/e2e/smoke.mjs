/**
 * The end-to-end check: a real browser, a real photo, real inference.
 *
 * Unit tests cover the Rust half and can prove the tiler merges without a
 * seam. What they cannot prove is that the nine ONNX graphs load in a
 * browser, that the preprocessing this app feeds them matches what they
 * were trained on, and that the result is actually better than the input.
 * That is what this does, and it is the reason it runs a full upscale
 * rather than asserting on the DOM.
 *
 *   node e2e/smoke.mjs [--headed] [--keep]
 *
 * It serves dist/ itself, so run a build first.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const DIST = join(here, "..", "dist");
const OUT = join(here, "output");
const PORT = 8099;
const headed = process.argv.includes("--headed");

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".onnx": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
};

function serve() {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://localhost:${PORT}`);
      let path = join(DIST, decodeURIComponent(url.pathname));
      if (url.pathname === "/" || !existsSync(path)) {
        if (existsSync(join(path, "index.html"))) path = join(path, "index.html");
        else if (!existsSync(path)) {
          res.writeHead(404).end("not found");
          return;
        }
      }
      const body = await readFile(path);
      res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(500).end(String(e));
    }
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

async function main() {
  if (!existsSync(join(DIST, "index.html"))) {
    console.error("smoke: dist/index.html missing — run `npm run build` first");
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const server = await serve();
  const browser = await chromium.launch({ headless: !headed });
  const page = await browser.newPage({ viewport: { width: 420, height: 900 } });

  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  const failed = [];
  page.on("requestfailed", (r) => failed.push(`${r.url()} ${r.failure()?.errorText}`));
  const missing = [];
  page.on("response", (r) => {
    if (r.status() >= 400) missing.push(`${r.status()} ${r.url()}`);
  });

  try {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: "networkidle" });
    check("home page renders", await page.getByRole("heading", { level: 1 }).isVisible());
    await page.screenshot({ path: join(OUT, "1-home.png"), fullPage: true });

    // The pricing page is the product's central claim; if it does not
    // render, the thing that differentiates this from every competitor is
    // gone and the build should not ship.
    await page.goto(`http://localhost:${PORT}/#/about`);
    await page.waitForTimeout(300);
    const aboutText = await page.locator("main").innerText();
    check("about page states the price", /no version that costs/i.test(aboutText));
    await page.screenshot({ path: join(OUT, "2-about.png"), fullPage: true });

    await page.goto(`http://localhost:${PORT}/#/models`);
    await page.waitForTimeout(500);
    check("downloads page lists every model", (await page.locator("main li").count()) === 9);
    // The website serves its own models, so there is nothing to configure.
    // The row exists in the shared component and must stay hidden here.
    check(
      "the website shows no model-source setting",
      (await page.getByLabel("Where models come from").count()) === 0,
    );
    await page.screenshot({ path: join(OUT, "3-models.png"), fullPage: true });

    // The real work. A deliberately small, deliberately soft input: a real
    // photo shrunk down, which is exactly the case the product is for.
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForTimeout(300);
    const photo = await readFile(join(here, "fixtures", "portrait.jpg"));
    await page.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', {
      name: "portrait.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    await page.waitForTimeout(1200);
    check("studio opened with the photo", (await page.locator(".preview img").count()) === 1);
    await page.screenshot({ path: join(OUT, "4-studio.png"), fullPage: true });

    await page.getByRole("button", { name: /^Enhance$/ }).click();

    // A cold run downloads a model and does real inference; on a CI CPU
    // that is not fast. The slider only appears when the whole job finished.
    await page.locator('[role="slider"]').waitFor({ timeout: 240_000 });
    check("upscale finished and the compare slider appeared", true);
    await page.waitForTimeout(600);
    await page.screenshot({ path: join(OUT, "5-result.png"), fullPage: true });

    // The measurements, which are the differentiating feature — and the
    // only automatic proof the output is genuinely better than the input.
    const metrics = await page.evaluate(() => {
      const el = [...document.querySelectorAll("*")].find((n) => n.className?.toString?.().includes("quality"));
      return el ? el.innerText : "";
    });
    check("quality panel shows a sharpness change", /sharper|as sharp/i.test(metrics), metrics.split("\n")[1] ?? "");

    await page.getByRole("button", { name: /The numbers/i }).click();
    await page.waitForTimeout(200);
    const table = await page.locator("table").innerText();
    check("PSNR and SSIM are reported", /PSNR/.test(table) && /SSIM/.test(table));
    await page.screenshot({ path: join(OUT, "6-numbers.png"), fullPage: true });

    const values = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("table tr")].map((r) => r.innerText);
      return rows.join("|");
    });
    const sharp = values.match(/Sharpness\s+([\d.]+)\s+([\d.]+)/);
    if (sharp) {
      const [, before, after] = sharp;
      check("the result is measurably sharper", Number(after) > Number(before) * 1.05, `${before} → ${after}`);
    } else {
      check("the result is measurably sharper", false, "no sharpness row found");
    }
    const ssim = values.match(/SSIM\s+([\d.]+)/);
    check("the result stays faithful to the input", ssim && Number(ssim[1]) > 0.6, ssim?.[1] ?? "none");

    // Saving is the last step of the job and the one a user judges the tool
    // by; a result that cannot be downloaded is not a result.
    const download = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /Save the photo/i }).click();
    const file = await download;
    await file.saveAs(join(OUT, "downloaded.png"));
    check("the photo downloads", file.suggestedFilename().endsWith(".png"), file.suggestedFilename());

    const dl2 = page.waitForEvent("download", { timeout: 30_000 });
    await page.getByRole("button", { name: /before\/after/i }).click();
    await (await dl2).saveAs(join(OUT, "before-after.png"));
    check("the before/after sheet downloads", true);

    check("no page errors", errors.length === 0, errors.slice(0, 2).join(" | "));
    check("no failed requests", failed.length === 0, failed.slice(0, 2).join(" | "));
    check("nothing 404ed", missing.length === 0, missing.slice(0, 3).join(" | "));
  } finally {
    if (!process.argv.includes("--keep")) await browser.close();
    server.close();
  }

  await writeFile(join(OUT, "report.json"), JSON.stringify(checks, null, 2));
  const bad = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - bad.length}/${checks.length} passed. Screenshots in e2e/output/`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
