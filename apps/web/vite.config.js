import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import { fileURLToPath } from "node:url";

// Relative base: the output is a folder of static files that has to work
// from a subpath, a file host or a CDN without being rebuilt for each.
export default defineConfig({
  base: "./",
  plugins: [svelte()],
  resolve: {
    alias: {
      // The OpenApps design tokens.
      //
      // This used to point at ../../../tokens, in the monorepo, which was
      // right while this app lived there and became wrong the moment it
      // became its own repository: that path is outside the repo, so a
      // clone of it could not build at all. The tokens are vendored under
      // src/vendor/openapps now, alongside the account bundle they style,
      // and this alias points inside the repo.
      //
      // Only the CSS and the three WOFF2 faces this app renders. The kit's
      // components pull icon glyphs from a CDN, and this build has to work
      // with no network at all. Refresh with scripts/vendor-openapps.sh.
      $tokens: fileURLToPath(new URL("./src/vendor/openapps", import.meta.url)),
      $lib: fileURLToPath(new URL("./src/lib", import.meta.url)),
      $ui: fileURLToPath(new URL("./src/ui", import.meta.url)),
      $views: fileURLToPath(new URL("./src/views", import.meta.url)),
      $wasm: fileURLToPath(new URL("./src/wasm", import.meta.url)),

      // onnxruntime-web's *non-bundled* builds.
      //
      // The default export condition resolves to `ort.*.bundle.min.mjs`,
      // which reaches its WebAssembly through `new URL(..., import.meta.url)`.
      // Rollup sees that, emits its own content-hashed copies of both
      // runtimes — tens of megabytes — and then nothing loads them, because
      // src/lib/engine/ort.js points `wasmPaths` at ./ort/ instead. The
      // non-bundled builds fetch both the glue and the binary from
      // `wasmPaths` at run time, so exactly one runtime is downloaded and
      // the bundler never sees a wasm import at all.
      "onnxruntime-web/webgpu": fileURLToPath(
        new URL("./node_modules/onnxruntime-web/dist/ort.webgpu.min.mjs", import.meta.url),
      ),
      "onnxruntime-web/wasm": fileURLToPath(
        new URL("./node_modules/onnxruntime-web/dist/ort.wasm.min.mjs", import.meta.url),
      ),
    },
  },
  build: {
    target: "es2022",
    // The two ONNX runtimes are large and mutually exclusive; keeping them
    // out of the main chunk is what lets a visitor download only the one
    // their browser can use.
    chunkSizeWarningLimit: 2048,
    // Vite would otherwise empty dist/ on every run, taking the 384 MB of
    // models and the ONNX runtime with it — files it did not put there and
    // will not put back. `scripts/build.sh` copies those in *after* this
    // step, so a bare `vite build` run against an existing dist would leave
    // a site that loads and then fails at the first model fetch. build.sh
    // does the cleaning instead.
    emptyOutDir: false,
  },
  worker: { format: "es" },
  server: { port: 8083 },
});
