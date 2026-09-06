import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

/*
  The extension bundles the *website's* source — `$web` points at
  apps/web/src — rather than keeping its own copy of the app. There is one
  Studio, one Batch, one set of strings and one engine; a second copy would
  agree on the day it was made and drift every day after.

  Only three files here are the extension's own: the service worker, the
  popup, and the app entry that supplies the model origin and the
  right-click handoff.
*/

const firefox = process.env.TARGET_BROWSER === "firefox";
const outDir = firefox ? "dist-firefox" : "dist";

// Where the models are fetched from. Overridable at build time so a fork,
// or a self-hosted deployment, can point at its own copies.
const modelOrigin = process.env.OPENPIXELS_MODELS ?? "https://openpixels.app/models/";

export default defineConfig({
  root: resolve(fileURLToPath(new URL(".", import.meta.url))),
  base: "./",
  plugins: [svelte()],
  define: {
    MODEL_ORIGIN: JSON.stringify(modelOrigin),
  },
  resolve: {
    alias: {
      $tokens: fileURLToPath(new URL("../../../tokens", import.meta.url)),
      $web: fileURLToPath(new URL("../web/src", import.meta.url)),
      $lib: fileURLToPath(new URL("../web/src/lib", import.meta.url)),
      $ui: fileURLToPath(new URL("../web/src/ui", import.meta.url)),
      $views: fileURLToPath(new URL("../web/src/views", import.meta.url)),
      $wasm: fileURLToPath(new URL("../web/src/wasm", import.meta.url)),
      // The same non-bundled onnxruntime builds the website uses, for the
      // same reason — see apps/web/vite.config.js.
      "onnxruntime-web/webgpu": fileURLToPath(
        new URL("../web/node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs", import.meta.url),
      ),
      "onnxruntime-web/wasm": fileURLToPath(
        new URL("../web/node_modules/onnxruntime-web/dist/ort.wasm.min.mjs", import.meta.url),
      ),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
    // Extension pages each live in their own isolated world with no shared
    // module cache, so Vite's modulepreload polyfill is meaningless there
    // and Chrome logs a warning about the unused <link>. Every browser this
    // supports has native modulepreload anyway.
    modulePreload: false,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: {
        app: resolve(fileURLToPath(new URL("src/app/app.html", import.meta.url))),
        popup: resolve(fileURLToPath(new URL("src/popup/popup.html", import.meta.url))),
        background: resolve(fileURLToPath(new URL("src/background/index.js", import.meta.url))),
      },
      output: {
        entryFileNames: "[name].js",
        chunkFileNames: "chunks/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]",
      },
    },
  },
  worker: { format: "es" },
});
