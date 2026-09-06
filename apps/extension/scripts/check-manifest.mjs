/**
 * Refuses to ship a build a browser would reject.
 *
 * Every check here stands for a mistake that produces no error at build
 * time and a broken extension at load time — a manifest naming a file the
 * bundler renamed, an icon that was never copied, a service worker that is
 * not a module. Store review is a slow way to find these out.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dist = process.argv[2];
if (!dist) {
  console.error("usage: check-manifest.mjs <dist dir>");
  process.exit(1);
}

const problems = [];
const manifestPath = join(dist, "manifest.json");
if (!existsSync(manifestPath)) {
  console.error(`check-manifest: no manifest.json in ${dist}`);
  process.exit(1);
}
const m = JSON.parse(readFileSync(manifestPath, "utf8"));
const firefox = Boolean(m.browser_specific_settings);

const need = (path, why) => {
  if (!existsSync(join(dist, path))) problems.push(`${why}: ${path} is missing`);
};

need(m.action?.default_popup, "the popup the toolbar button opens");
need("app.html", "the app page the popup and the context menu open");
for (const [size, path] of Object.entries(m.icons ?? {})) need(path, `the ${size}px icon`);
for (const [size, path] of Object.entries(m.action?.default_icon ?? {})) need(path, `the ${size}px toolbar icon`);

if (firefox) {
  const scripts = m.background?.scripts ?? [];
  if (!scripts.length) problems.push("Firefox needs background.scripts, not background.service_worker");
  scripts.forEach((s) => need(s, "the background script"));
} else {
  if (!m.background?.service_worker) problems.push("Chrome needs background.service_worker");
  else need(m.background.service_worker, "the service worker");
}
if (m.background?.type !== "module") {
  problems.push("background.type must be \"module\" — the bundle uses import syntax");
}

// A default_locale means every __MSG_x__ has to resolve, or the extension
// shows the literal placeholder as its name in the store.
if (m.default_locale) {
  const messagesPath = join(dist, "_locales", m.default_locale, "messages.json");
  if (!existsSync(messagesPath)) {
    problems.push(`default_locale is ${m.default_locale} but _locales/${m.default_locale}/messages.json is missing`);
  } else {
    const messages = JSON.parse(readFileSync(messagesPath, "utf8"));
    for (const field of ["name", "description"]) {
      const value = m[field] ?? "";
      const key = value.match(/^__MSG_(.+)__$/)?.[1];
      if (key && !messages[key]) problems.push(`manifest ${field} uses __MSG_${key}__, which _locales does not define`);
    }
  }
}

// The runtime binaries the app resolves at run time. Nothing imports them,
// so nothing else would notice they are absent until a user pressed Enhance.
const ortDir = join(dist, "ort");
if (!existsSync(ortDir) || !readdirSync(ortDir).some((f) => f.endsWith(".wasm"))) {
  problems.push("ort/ has no runtime — inference would fail on the first click");
}
if (!existsSync(join(dist, "assets")) && !existsSync(join(dist, "chunks"))) {
  problems.push("no bundled assets — did vite build actually run?");
}
const wasmCore = readdirSync(join(dist, "assets"), { withFileTypes: true }).some(
  (e) => e.isFile() && e.name.startsWith("pixels_core") && e.name.endsWith(".wasm"),
);
if (!wasmCore) problems.push("assets/ has no pixels_core wasm — the image core is missing");

// A store will reject a build over 100 MB even before a human looks at it.
const bytes = readdirSync(dist, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile())
  .reduce((sum, e) => sum + readFileSync(join(e.parentPath ?? e.path, e.name)).length, 0);
if (bytes > 100e6) problems.push(`the package is ${(bytes / 1e6).toFixed(0)} MB, over the 100 MB store limit`);

if (problems.length) {
  console.error("check-manifest: this build would not load\n");
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`  manifest ok (${firefox ? "Firefox" : "Chrome/Edge"}, ${(bytes / 1e6).toFixed(1)} MB)`);
