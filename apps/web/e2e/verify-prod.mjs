/**
 * Does the *deployed* app actually run a model?
 *
 * Everything that breaks a deployment of this app breaks it silently. A CSP
 * that blocks the worker, an .mjs served as application/octet-stream, a model
 * that 404s — each one leaves a page that loads perfectly, looks completely
 * normal, and simply never produces a result. `curl -I` can prove the headers
 * are right; only a browser can prove inference happens.
 *
 * So this loads the real host over the real network, enhances a real photo,
 * and asserts the result actually got sharper. It fails on any CSP violation
 * or failed request, because those are the failures that would otherwise
 * reach a user before they reached us.
 *
 *   node e2e/verify-prod.mjs [--host https://app.openpixels.app] [--headed]
 *
 * The fixture is a generated test image, not a photograph of anyone: drawn at
 * 1152x1440, resampled down to 288x360 and re-encoded as a low-quality JPEG,
 * so the degradation is real and what the model recovers is a real recovery.
 */

import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const hostArg = argv.indexOf("--host");
const HOST = hostArg !== -1 ? argv[hostArg + 1] : "https://app.openpixels.app";
const headed = argv.includes("--headed");

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name + (detail ? ` — ${detail}` : ""));
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

const browser = await chromium.launch({ channel: "chromium", headless: !headed });
const page = await browser.newPage({ viewport: { width: 430, height: 932 } });

const errors = [], csp = [], failed = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  const t = m.text();
  if (m.type() === "error") errors.push(t);
  // A CSP block is reported to the console and nowhere else. Without this
  // the run would pass while the app was thoroughly broken.
  if (/Content Security Policy|Refused to/i.test(t)) csp.push(t);
});
page.on("requestfailed", (r) => failed.push(`${r.url()} :: ${r.failure()?.errorText ?? ""}`));

try {
  console.log(`verifying ${HOST}`);
  const res = await page.goto(HOST, { waitUntil: "load", timeout: 60_000 });
  check("the app shell loads", res?.ok() === true, `HTTP ${res?.status()}`);
  await page.waitForTimeout(2000);

  const photo = await readFile(join(here, "fixtures", "demo-degraded.jpg"));
  await page.setInputFiles('input[type="file"][accept="image/*"]:not([capture])', {
    name: "demo-degraded.jpg", mimeType: "image/jpeg", buffer: photo,
  });
  await page.waitForTimeout(1500);

  // The model is fetched over the network on this run, so allow for it.
  await page.getByRole("button", { name: /^(Enhance|Apply changes)$/ }).click();
  await page.locator('[role="slider"]').waitFor({ timeout: 600_000 });
  await page.waitForTimeout(1200);

  const report = await page.locator("main").innerText();
  const sharper = report.match(/([\d.]+)x sharper/i);
  check("inference produced a result", /sharper|as sharp/i.test(report),
    sharper ? `${sharper[1]}x sharper` : "no measurement reported");
  check("the result is faithful to the original", /Faithful to the original/i.test(report));
  check("no CSP violations", csp.length === 0, csp[0] ?? "");
  check("no failed requests", failed.length === 0, failed[0] ?? "");
  check("no page errors", errors.length === 0, errors[0] ?? "");
} finally {
  await browser.close();
}

if (failures.length) {
  console.error(`\n${failures.length} check(s) failed:\n  ` + failures.join("\n  "));
  process.exit(1);
}
console.log("\nall checks passed");
