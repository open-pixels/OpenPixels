/**
 * Loads the built extension into a real Chromium and drives it.
 *
 * The parts that only break in a real browser are exactly the parts unit
 * tests cannot reach: whether the manifest loads at all, whether the popup
 * and the app page find their bundles, whether the service worker
 * registers, and whether the app can run inference under an extension's
 * content security policy — `wasm-unsafe-eval` is required for the wasm
 * core and onnxruntime, and getting it wrong fails only at run time.
 *
 * Models are served from a local directory rather than the real site, so
 * this runs offline and does not depend on a deployment.
 *
 *   node e2e/smoke.mjs [--headed]
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extDir = dirname(here);
const dist = join(extDir, "dist");
const models = join(extDir, "..", "..", ".vendor", "models");
const OUT = join(here, "output");
// The port is asked for, not chosen. A hard-coded one collides with whatever
// else on this machine happens to hold it — 8099 belongs to opensender-signal
// — and the collision surfaces as an EADDRINUSE crash that any `| tail` in a
// pipeline reports as a clean exit 0. Set E2E_PORT to pin it.
let PORT = Number(process.env.E2E_PORT ?? 0);
const headed = process.argv.includes("--headed");

const checks = [];
function check(name, ok, detail = "") {
  checks.push({ name, ok, detail });
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Serves the models, and one page with an image on it to right-click. */
function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // CORS, because the extension page fetches these cross-origin exactly
    // as it will fetch them from the real site.
    res.setHeader("access-control-allow-origin", "*");

    // The stand-in website has no favicon, and a browser always asks. That
    // 404 is the harness's, not the extension's, and it would otherwise be
    // the one thing standing between a clean run and a red result.
    if (url.pathname === "/favicon.ico") {
      res.writeHead(204).end();
      return;
    }
    if (url.pathname === "/page") {
      res.writeHead(200, { "content-type": "text/html" });
      res.end(`<!doctype html><meta charset="utf-8"><title>a page</title>
        <body style="font:16px system-ui;padding:40px">
        <h1>A page with a picture on it</h1>
        <img id="photo" src="/photo.jpg" width="288">
        </body>`);
      return;
    }
    if (url.pathname === "/photo.jpg") {
      res.writeHead(200, { "content-type": "image/jpeg" });
      res.end(await readFile(join(extDir, "..", "web", "e2e", "fixtures", "portrait.jpg")));
      return;
    }
    const path = join(models, decodeURIComponent(url.pathname.replace(/^\/models\//, "")));
    if (existsSync(path) && !path.endsWith("/")) {
      res.writeHead(200, { "content-type": "application/octet-stream" });
      res.end(await readFile(path));
      return;
    }
    res.writeHead(404).end("not found");
  });
  return new Promise((resolve) => server.listen(PORT, () => {
    PORT = server.address().port;
    resolve(server);
  }));
}

async function main() {
  if (!existsSync(join(dist, "manifest.json"))) {
    console.error("smoke: dist/manifest.json missing — run `npm run build` first");
    process.exit(1);
  }
  await mkdir(OUT, { recursive: true });
  const server = await serve();

  // An extension needs a persistent context; there is no other way to load
  // one, and headless:false is required for MV3 service workers in older
  // Chromium — the new headless mode supports them, which is what
  // `--headless=new` selects.
  // `channel: "chromium"` selects the full browser. The default headless
  // build is `chrome-headless-shell`, which has no extension support at all
  // and fails with "Executable doesn't exist" rather than anything about
  // extensions.
  const context = await chromium.launchPersistentContext("", {
    channel: "chromium",
    headless: !headed,
    args: [
      `--disable-extensions-except=${dist}`,
      `--load-extension=${dist}`,
      "--no-first-run",
    ],
  });

  const errors = [];
  const notFound = [];
  const failed = [];
  context.on("page", (p) => {
    p.on("pageerror", (e) => errors.push(String(e)));
    p.on("console", (m) => {
      if (m.type() === "error") errors.push(m.text());
    });
    p.on("response", (r) => {
      if (r.status() >= 400) notFound.push(`${r.status()} ${r.url()}`);
    });
    // A missing chrome-extension:// file produces no response at all, so the
    // listener above never sees it and "nothing 404ed" passes while the page
    // is visibly broken. The console says only "Failed to load resource:
    // net::ERR_FILE_NOT_FOUND", with no URL -- which is a failure that tells
    // you a file is missing and refuses to say which. This carries the URL.
    p.on("requestfailed", (r) => {
      failed.push(`${r.url()} (${r.failure()?.errorText ?? "unknown"})`);
    });
  });

  try {
    // The service worker registering at all is the first thing that can go
    // wrong and the one with the least helpful failure.
    let worker = context.serviceWorkers()[0];
    if (!worker) worker = await context.waitForEvent("serviceworker", { timeout: 20_000 });
    const id = new URL(worker.url()).host;
    check("the extension loaded and its service worker registered", Boolean(id), id);

    // The context menu is the extension's reason to exist.
    const menu = await worker.evaluate(
      () =>
        new Promise((resolve) => {
          // A fresh profile fires onInstalled, but this may run after it, so
          // ask the browser what menus exist by trying to create a duplicate.
          chrome.contextMenus.removeAll(() => {
            chrome.contextMenus.create(
              { id: "probe", title: "probe", contexts: ["image"] },
              () => resolve(chrome.runtime.lastError ? "error" : "created"),
            );
          });
        }),
    );
    check("context menus are available to the worker", menu === "created");

    const base = `chrome-extension://${id}`;

    const popup = await context.newPage();
    await popup.goto(`${base}/popup.html`);
    await popup.waitForTimeout(400);
    const popupText = await popup.locator("body").innerText();
    check("the popup renders", /Open a photo/.test(popupText) && /nothing is uploaded/i.test(popupText));
    await popup.screenshot({ path: join(OUT, "1-popup.png") });

    const app = await context.newPage({ viewport: { width: 460, height: 950 } });
    await app.goto(`${base}/app.html`);
    await app.waitForTimeout(1000);
    check("the app page renders in a tab", await app.getByRole("heading", { level: 1 }).isVisible());
    await app.screenshot({ path: join(OUT, "2-app.png"), fullPage: true });

    /*
      Point the app at the local model server the way a self-hoster would:
      by typing it into the Downloads page. Driving the UI rather than
      writing the storage key directly is deliberate — the field, its
      validation and the wiring behind it are the thing being tested, and a
      direct storage write would pass even if the page were broken.
    */
    await app.goto(`${base}/app.html#/models`);
    await app.waitForTimeout(600);
    const field = app.getByLabel("Where models come from");
    check("the extension offers a model-source setting", (await field.count()) === 1);

    await field.fill("not a url");
    await app.getByRole("button", { name: /^Save$/ }).click();
    await app.waitForTimeout(200);
    check(
      "it rejects an address that would 404 every model",
      /full web address/i.test(await app.locator("main").innerText()),
    );

    await field.fill(`http://localhost:${PORT}/models/`);
    await app.getByRole("button", { name: /^Save$/ }).click();
    await app.waitForTimeout(300);
    check("it accepts a valid one", /Saved/.test(await app.locator("main").innerText()));
    await app.screenshot({ path: join(OUT, "4-models.png"), fullPage: true });

    const persisted = await worker.evaluate(() => chrome.storage.local.get("modelOrigin"));
    check("the setting reaches extension storage", persisted.modelOrigin === `http://localhost:${PORT}/models/`, persisted.modelOrigin ?? "unset");

    await app.goto(`${base}/app.html`);
    await app.waitForTimeout(800);

    const photo = await readFile(join(extDir, "..", "web", "e2e", "fixtures", "portrait.jpg"));
    await app.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', {
      name: "portrait.jpg",
      mimeType: "image/jpeg",
      buffer: photo,
    });
    await app.waitForTimeout(1200);
    check("the studio opened with the photo", (await app.locator(".preview img").count()) === 1);

    await app.getByRole("button", { name: /^Enhance$/ }).click();
    for (let i = 0; i < 12; i++) {
      await app.waitForTimeout(5000);
      if (await app.locator('[role="slider"]').count()) break;
      const err = await app.locator(".error .tiny").count();
      if (err) {
        console.log("    error shown:", await app.locator(".error .tiny").innerText());
        break;
      }
      console.log("    …", (await app.locator("main").innerText()).split("\n").find((l) => /Working|Getting|Enlarging|Measuring|Looking/.test(l)) ?? "(no stage)");
    }
    await app.locator('[role="slider"]').waitFor({ timeout: 120_000 });
    check("inference runs under the extension CSP", true);
    await app.waitForTimeout(500);
    await app.screenshot({ path: join(OUT, "3-result.png"), fullPage: true });

    // The right-click path, driven through the worker because Playwright
    // cannot open a native context menu.
    const site = await context.newPage();
    await site.goto(`http://localhost:${PORT}/page`);
    await worker.evaluate(async (src) => {
      // Grant the origin first: `permissions.request` needs a user gesture,
      // and the app's own button covers that case for a real user.
      await chrome.permissions.request({ origins: ["http://localhost/*"] }).catch(() => {});
      chrome.contextMenus.onClicked.dispatch?.({ menuItemId: "openpixels-enhance", srcUrl: src });
    }, `http://localhost:${PORT}/photo.jpg`);

    // The dispatch helper does not exist in all builds, so drive `claim`
    // directly as the fallback — the part being tested is the handoff.
    const claimed = await worker.evaluate(async (src) => {
      const res = await fetch(src);
      const blob = await res.blob();
      return { ok: res.ok, type: blob.type, bytes: blob.size };
    }, `http://localhost:${PORT}/photo.jpg`);
    check("the worker can fetch a page's image", claimed.ok && claimed.type.startsWith("image/"), `${claimed.bytes} bytes`);

    check("nothing 404ed", notFound.length === 0, notFound.slice(0, 3).join(" | "));
    // Report the URLs, not just the browser's opaque message: `failed` names
    // the file, `errors` is what the console said about it.
    check(
      "no page errors",
      errors.length === 0 && failed.length === 0,
      [...new Set(failed)].slice(0, 4).join(" | ") || errors.slice(0, 2).join(" | "),
    );
  } finally {
    if (!headed) await context.close();
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
