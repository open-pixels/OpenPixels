/**
 * The main thread's handle on the worker.
 *
 * One worker for the whole app: model sessions cost hundreds of megabytes
 * to build and a batch reuses them, so a worker per job would be both
 * slower and far heavier.
 */

let worker = null;
let seq = 0;
const pending = new Map();
const jobs = new Map();

function ensure() {
  if (worker) return worker;
  worker = new Worker(new URL("./worker.js", import.meta.url), { type: "module" });
  worker.onmessage = (event) => {
    const msg = event.data;
    if (msg.job != null && jobs.has(msg.job)) {
      const entry = jobs.get(msg.job);
      if (msg.type === "progress") {
        entry.onProgress?.(msg);
        return;
      }
      jobs.delete(msg.job);
      if (msg.type === "done") {
        entry.resolve({
          image: { width: msg.width, height: msg.height, data: new Uint8Array(msg.data) },
          alpha: msg.alpha ? new Uint8Array(msg.alpha) : null,
          metrics: msg.metrics,
          faces: msg.faces,
          monochrome: msg.monochrome,
          capped: msg.capped,
        });
      } else if (msg.type === "cancelled") {
        entry.reject(Object.assign(new Error("cancelled"), { cancelled: true }));
      } else {
        entry.reject(new Error(msg.message ?? "processing failed"));
      }
      return;
    }
    if (msg.id != null && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.type === "error" ? reject(new Error(msg.message)) : resolve(msg);
    }
  };
  worker.onerror = (e) => {
    const err = new Error(e.message || "the image engine failed to start");
    for (const { reject } of pending.values()) reject(err);
    for (const { reject } of jobs.values()) reject(err);
    pending.clear();
    jobs.clear();
  };
  return worker;
}

function ask(message) {
  const id = ++seq;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ensure().postMessage({ ...message, id });
  });
}

let configured = null;

/**
 * Start the worker and tell it where the app is served from.
 *
 * Every other call goes through this first: the worker resolves the model
 * and ONNX-runtime URLs against the base, so a `cached()` that raced ahead
 * of the config would look in the wrong place and report nothing on the
 * device.
 */
export function configure(options = {}) {
  configured ??= ask({
    type: "config",
    baseUrl: document.baseURI,
    ...options,
  });
  return configured;
}

async function afterConfig(message) {
  await configure();
  return ask(message);
}

export function cached() {
  return afterConfig({ type: "cached" });
}

export function forget(model) {
  return afterConfig({ type: "forget", model });
}

export function releaseModels() {
  return afterConfig({ type: "release" });
}

/**
 * Strip anything the structured-clone algorithm will not take.
 *
 * The options come from Svelte `$state`, which hands out a Proxy — and a
 * Proxy cannot be cloned. A shallow spread looks like it solves this and
 * does not: the nested array survives as a proxy, and `postMessage` fails
 * with "[object Object] could not be cloned", naming neither the field nor
 * the reason. Doing it here rather than at each call site means a new
 * caller cannot reintroduce the bug.
 */
function plain(value) {
  if (Array.isArray(value)) return value.map(plain);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  }
  return value;
}

/**
 * Run a job. Returns a promise with a `cancel()` on it, so a caller can
 * abandon a long upscale without unwinding its own state first.
 */
export function process(img, opts, onProgress) {
  const id = ++seq;
  // Cheap when already configured, and the only thing standing between a
  // fast first click and a job that resolves its model URLs against nothing.
  configure();
  // The buffer is transferred, so hand over a copy — the caller still has
  // the original on screen behind the progress bar.
  const data = img.data.slice();
  const promise = new Promise((resolve, reject) => {
    jobs.set(id, { resolve, reject, onProgress });
    ensure().postMessage(
      { type: "job", job: id, width: img.width, height: img.height, data: data.buffer, opts: plain(opts) },
      [data.buffer],
    );
  });
  promise.cancel = () => worker?.postMessage({ type: "cancel", job: id });
  return promise;
}
