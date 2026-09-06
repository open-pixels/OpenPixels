/**
 * onnxruntime-web, in whichever build this browser can actually use.
 *
 * The WebGPU build runs Real-ESRGAN roughly an order of magnitude faster
 * than the CPU one, which on a phone is the difference between "a moment"
 * and "did it freeze". It is also a much larger download. Since they are
 * separate files, the right move is to decide at run time and fetch exactly
 * one — a static import of both would cost every visitor the union.
 *
 * The `.wasm` binaries are copied into `./ort/` by the build script and
 * served from this origin: the default resolves them against a CDN, which
 * this app has no business talking to.
 */

let ready;

export function hasWebGPU() {
  return typeof navigator !== "undefined" && "gpu" in navigator;
}

export function loadOrt() {
  ready ??= init();
  return ready;
}

async function init() {
  const webgpu = hasWebGPU();
  const ort = webgpu ? await import("onnxruntime-web/webgpu") : await import("onnxruntime-web/wasm");

  ort.env.wasm.wasmPaths = new URL("./ort/", baseUrl()).href;
  // Multi-threading needs cross-origin isolation (COOP/COEP), which a plain
  // static host does not send. Asking for threads without it makes
  // onnxruntime probe, fail and fall back, so ask for one and skip the probe.
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  return { ort, webgpu };
}

/**
 * Where the app's own files live — the directory `index.html` was served
 * from, which is what `./ort/` and `./models/` are relative to.
 *
 * In a page this is `document.baseURI`. A worker has no document, and
 * deriving it from `import.meta.url` would be a guess about how many
 * directories deep the bundler happened to put the worker chunk — a guess
 * that is silently wrong the day that changes, and whose only symptom is a
 * 404 for a runtime binary. So the main thread, which knows, sends it in
 * the `config` message and `setBaseUrl` records it here.
 */
let base = null;

export function setBaseUrl(url) {
  base = url;
}

export function baseUrl() {
  if (base) return base;
  if (typeof document !== "undefined" && document.baseURI) return document.baseURI;
  throw new Error("base URL not configured — the worker must be sent a config message first");
}

/**
 * Session options.
 *
 * `enableMemPattern: false` is the load-bearing one. With it on,
 * onnxruntime plans buffers on the first run and reuses them, and the
 * Real-ESRGAN graphs — whose last step adds the network's output to the
 * input resized 4x — end up trying to write a 4x tensor into the buffer
 * they read the input from:
 *
 *   Shape mismatch attempting to re-use buffer. {1,288,288,3} != {1,1152,1152,3}
 *
 * The message names an onnxruntime source path and suggests checking the
 * model's dim_params, which sends you looking in the wrong place: the
 * export is correct and the CPU backend runs it fine. Turning the planner
 * off costs a little allocation per run and makes the fast path work at all.
 *
 * `freeDimensionOverrides` pins the graph's named axes to the one shape it
 * will actually see, which is what lets the remaining optimisation happen
 * despite the dynamic export — hence `pad` being a constant of the tile
 * settings rather than of the photo.
 */
function options(providers, pad) {
  const opts = {
    executionProviders: providers,
    graphOptimizationLevel: "all",
    enableMemPattern: false,
    /*
      Errors only. `env.logLevel` above governs onnxruntime's JavaScript
      layer; this governs the native one, which is what emits graph-level
      warnings during session creation — GFPGAN produces two on every load,
      about a node in its StyleGAN decoder that cannot be constant-folded.
      They are harmless and unactionable, and the emscripten runtime prints
      them through `console.error`, so without this every user who restores
      a face gets red text in their console for something that is working.
    */
    logSeverityLevel: 3,
  };
  if (pad) opts.freeDimensionOverrides = { height: pad, width: pad };
  return opts;
}

/**
 * Create a session, falling back to CPU if WebGPU refuses the graph.
 *
 * Not defensive padding: WebGPU support is uneven enough across drivers
 * that a provider reporting as present can still fail on a specific model,
 * and the useful behaviour there is a slower photo, not an error page.
 */
export async function createSession(bytes, { preferCpu = false, pad = 0 } = {}) {
  const { ort, webgpu } = await loadOrt();
  if (webgpu && !preferCpu) {
    try {
      const session = await ort.InferenceSession.create(bytes, options(["webgpu"], pad));
      return { session, provider: "webgpu", ort };
    } catch (e) {
      console.warn("WebGPU session failed, falling back to CPU:", e);
    }
  }
  const session = await ort.InferenceSession.create(bytes, options(["wasm"], pad));
  return { session, provider: "cpu", ort };
}
