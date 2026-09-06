/**
 * Offline support.
 *
 * The home page claims that after one visit the app works with no signal.
 * This is the whole of what makes that true, so it is written to be boring:
 * precache the shell on install, serve cached-first for everything
 * immutable, and never let a failed request become a blank page.
 *
 * The models are deliberately *not* precached. They are up to 300 MB, and
 * src/lib/engine/models.js puts each in its own cache as it streams, with a
 * progress bar and a page that lists and deletes them. Precaching them
 * would mean a silent hundreds-of-megabytes download on first paint for
 * someone who came to read the pricing page.
 */

const BUILD = "__BUILD_ID__";
const CACHE = `openpixels-${BUILD}`;

// The app shell. Everything else — the code-split ONNX runtime chunks, the
// wasm binaries, the fonts — is cached on first use by the fetch handler,
// because which of them a given browser needs is only knowable at run time.
const SHELL = ["./", "./index.html", "./manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k.startsWith("openpixels-") && k !== CACHE).map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // The model cache is owned by models.js, which streams with progress and
  // lets the Downloads page delete entries. Letting this handler cache them
  // too would double the storage and leave copies that page cannot remove.
  if (url.pathname.includes("/models/")) return;

  // Navigations: network first, so a deployed update is picked up on the
  // next visit rather than after an unpredictable expiry — falling back to
  // the cached shell, which is what makes an offline launch work.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("./index.html", copy));
          return res;
        })
        .catch(() => caches.match("./index.html").then((r) => r ?? Response.error())),
    );
    return;
  }

  // Everything else is content-hashed or version-pinned, so cache-first is
  // both correct and the fast path.
  event.respondWith(
    caches.match(request).then((hit) => {
      if (hit) return hit;
      return fetch(request).then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(request, copy));
        }
        return res;
      });
    }),
  );
});
