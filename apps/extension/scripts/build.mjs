/**
 * Builds the extension for Chrome/Edge or Firefox.
 *
 * Vite does the bundling; this script does the four things Vite has no
 * opinion about: flatten the HTML entries to the paths the manifest names,
 * pick the right manifest, copy the ONNX runtime that no bundler ever sees,
 * and check the result is loadable before anyone tries.
 */

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const extDir = dirname(dirname(fileURLToPath(import.meta.url)));
const webDir = join(extDir, "..", "web");
const firefox = process.env.TARGET_BROWSER === "firefox";
const dist = join(extDir, firefox ? "dist-firefox" : "dist");

const log = (m) => console.log(`\x1b[1m==> ${m}\x1b[0m`);

// The wasm the app imports is built by the website's script; there is one
// core and one build of it.
if (!existsSync(join(webDir, "src", "wasm", "pixels_core.js"))) {
  log("Building the Rust core (apps/web/scripts/build-wasm.sh)");
  execFileSync("bash", [join(webDir, "scripts", "build-wasm.sh")], { stdio: "inherit" });
}

log(`Bundling for ${firefox ? "Firefox" : "Chrome/Edge"}`);
execFileSync("npx", ["vite", "build"], { cwd: extDir, stdio: "inherit", env: process.env });

// Vite mirrors an HTML entry's path relative to `root`, so src/app/app.html
// lands at dist/src/app/app.html. The manifest names flat paths, as every
// other extension does, so move them up and drop the empty tree.
//
// Moving the file is only half of it: with `base: "./"` Vite wrote the
// script and stylesheet hrefs relative to the *nested* location, so they
// start `../../`. Left alone they resolve above the extension root, the
// page loads with no script and no styles, and the only symptom is a blank
// tab — so rewrite them to be relative to where the file now is.
log("Flattening the page entries");
for (const [from, to] of [
  ["src/app/app.html", "app.html"],
  ["src/popup/popup.html", "popup.html"],
]) {
  const nested = join(dist, from);
  if (!existsSync(nested)) throw new Error(`expected Vite to emit ${from} — did an entry name change?`);
  const depth = from.split("/").length - 1;
  const prefix = "../".repeat(depth);
  let html = readFileSync(nested, "utf8");
  html = html.replaceAll(`"${prefix}`, '"./');
  if (html.includes("../")) {
    throw new Error(`${to} still has a parent-relative path after flattening:\n${html}`);
  }
  writeFileSync(join(dist, to), html);
  rmSync(nested);
}
rmSync(join(dist, "src"), { recursive: true, force: true });

// publicDir copies both manifests into every build. Install the right one
// and remove the other, so each dist has exactly one, correctly shaped.
log("Installing the manifest");
if (firefox) {
  rmSync(join(dist, "manifest.json"), { force: true });
  renameSync(join(dist, "manifest.firefox.json"), join(dist, "manifest.json"));
} else {
  rmSync(join(dist, "manifest.firefox.json"), { force: true });
}

// The ONNX runtime binaries: resolved at run time from `wasmPaths`, so no
// bundler sees them and nothing copies them unless this does. Read the
// names out of the bundles rather than hard-coding them — which pair each
// wants has changed between onnxruntime versions.
log("Copying the ONNX runtime");
const ortSrc = join(webDir, "node_modules", "onnxruntime-web", "dist");
mkdirSync(join(dist, "ort"), { recursive: true });
const needed = new Set();
for (const bundle of ["ort.webgpu.min.mjs", "ort.wasm.min.mjs"]) {
  const text = readFileSync(join(ortSrc, bundle), "utf8");
  for (const m of text.matchAll(/ort-wasm[a-z0-9.-]*\.mjs/g)) {
    needed.add(m[0]);
    needed.add(m[0].replace(/\.mjs$/, ".wasm"));
  }
}
for (const file of needed) {
  if (!existsSync(join(ortSrc, file))) throw new Error(`onnxruntime-web did not ship ${file}`);
  cpSync(join(ortSrc, file), join(dist, "ort", file));
}

// The popup references its icon by a path relative to itself.
mkdirSync(join(dist, "icons"), { recursive: true });
for (const size of [16, 48, 128]) {
  cpSync(join(webDir, "public", "icons", `icon-${size}.png`), join(dist, "icons", `icon-${size}.png`));
}

log("Checking the result");
execFileSync("node", [join(extDir, "scripts", "check-manifest.mjs"), dist], { stdio: "inherit" });

// Mozilla's own validator, on the build it will actually receive. It reports
// four warnings that cannot be fixed from here — see README — but any
// *error* is a rejected submission, and finding that out at build time beats
// finding it out a week into review.
if (firefox) {
  log("Linting against Mozilla's rules");
  try {
    const report = execFileSync(
      "npx",
      ["web-ext", "lint", `--source-dir=${dist}`, "--no-config-discovery", "--output=json"],
      { cwd: extDir, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
    );
    const { errors = [], warnings = [] } = JSON.parse(report);
    if (errors.length) {
      for (const e of errors) console.error(`  ${e.code}  ${e.file ?? ""}  ${e.message}`);
      throw new Error(`web-ext lint found ${errors.length} error(s)`);
    }
    console.log(`  lint ok (0 errors, ${warnings.length} known warnings)`);
  } catch (e) {
    // `web-ext lint` exits non-zero when it finds warnings, so a thrown
    // error here is only fatal if it is ours.
    if (e.message?.startsWith("web-ext lint found")) throw e;
    const out = e.stdout?.toString() ?? "";
    try {
      const { errors = [], warnings = [] } = JSON.parse(out);
      if (errors.length) {
        for (const err of errors) console.error(`  ${err.code}  ${err.file ?? ""}  ${err.message}`);
        throw new Error(`web-ext lint found ${errors.length} error(s)`);
      }
      console.log(`  lint ok (0 errors, ${warnings.length} known warnings)`);
    } catch (parseFailure) {
      if (parseFailure.message?.startsWith("web-ext lint found")) throw parseFailure;
      console.log("  (web-ext lint unavailable — skipped)");
    }
  }
}

const size = (dir) =>
  readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .reduce((sum, e) => sum + readFileSync(join(e.parentPath ?? e.path, e.name)).length, 0);

log("Done");
console.log(`  output: ${dist}`);
console.log(`  size:   ${(size(dist) / 1e6).toFixed(1)} MB`);
console.log(`  models: fetched at run time from ${JSON.stringify(process.env.OPENPIXELS_MODELS ?? "https://openpixels.app/models/")}`);
