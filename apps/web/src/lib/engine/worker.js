/**
 * The worker the whole engine runs in.
 *
 * Two reasons it exists. A 4x pass on a phone takes tens of seconds, and
 * the compare slider, the cancel button and the batch list all have to keep
 * responding through it. And the wasm module holds large buffers — keeping
 * them off the main thread's heap is what stops a big photo taking the tab
 * down with it.
 *
 * The protocol is deliberately small: one `job` in, `progress` out
 * repeatedly, then `done` or `error`. Cancellation is cooperative — the
 * pipeline yields between tiles, and this checks a flag there.
 */

import { loadWasm, process as runPipeline, looksMonochrome, releaseSessions } from "./pipeline.js";
import { setModelOrigin, cachedModels, forgetModel, MODELS } from "./models.js";
import { setBaseUrl } from "./ort.js";

let cancelled = new Set();

class Cancelled extends Error {
  constructor() {
    super("cancelled");
    this.name = "Cancelled";
  }
}

self.onmessage = async (event) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case "config":
        // Before anything else: every other path resolves URLs against it.
        setBaseUrl(msg.baseUrl);
        if (msg.modelOrigin) setModelOrigin(msg.modelOrigin);
        await loadWasm();
        post({ type: "ready", id: msg.id, models: MODELS });
        break;

      case "cached":
        post({ type: "cached", id: msg.id, cached: await cachedModels() });
        break;

      case "forget":
        await forgetModel(msg.model);
        post({ type: "cached", id: msg.id, cached: await cachedModels() });
        break;

      case "cancel":
        cancelled.add(msg.job);
        break;

      case "job":
        await job(msg);
        break;

      case "release":
        releaseSessions();
        post({ type: "released", id: msg.id });
        break;

      default:
        throw new Error(`unknown message ${msg.type}`);
    }
  } catch (e) {
    post({ type: "error", id: msg.id, job: msg.job, message: String(e?.message ?? e) });
  }
};

function post(message, transfer) {
  self.postMessage(message, transfer ?? []);
}

async function job(msg) {
  const { job: id, width, height, opts } = msg;
  const img = { width, height, data: new Uint8Array(msg.data) };
  await loadWasm();

  const report = (info) => {
    if (cancelled.has(id)) throw new Cancelled();
    post({ type: "progress", job: id, ...info });
  };

  try {
    const mono = looksMonochrome(img);
    const result = await runPipeline(img, opts, report);
    if (cancelled.has(id)) throw new Cancelled();

    const payload = {
      type: "done",
      job: id,
      width: result.image.width,
      height: result.image.height,
      data: result.image.data.buffer,
      metrics: result.metrics,
      faces: result.faces,
      monochrome: mono,
      capped: result.capped,
    };
    const transfer = [result.image.data.buffer];
    if (result.alpha) {
      payload.alpha = result.alpha.buffer;
      transfer.push(result.alpha.buffer);
    }
    post(payload, transfer);
  } catch (e) {
    if (e instanceof Cancelled || cancelled.has(id)) {
      post({ type: "cancelled", job: id });
    } else {
      throw e;
    }
  } finally {
    cancelled.delete(id);
  }
}
