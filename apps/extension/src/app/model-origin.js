/**
 * Where this extension fetches model weights from.
 *
 * Defaults to the build-time constant — the project's own site — and can be
 * pointed elsewhere. That is not a test seam: an extension that promises
 * nothing leaves your machine still reaches out for ~380 MB of weights on
 * first use, and the honest answer to "must I trust your CDN for that" is
 * to let anyone serve the same checksummed files themselves.
 *
 *   chrome.storage.local.set({ modelOrigin: "https://example.internal/models/" })
 *
 * MODELS.md lists every file and its sha256, so a self-hosted copy can be
 * verified against the same pins the build uses.
 */

const ext = globalThis.browser ?? chrome;

/** What the user has chosen, or "" for the default. */
async function stored() {
  try {
    const result = await ext.storage.local.get("modelOrigin");
    const value = result?.modelOrigin;
    return typeof value === "string" ? value : "";
  } catch {
    // No storage access, or an extension context that has gone away. The
    // default is right in both cases.
    return "";
  }
}

export async function modelOrigin() {
  const value = await stored();
  // A bare origin with no trailing slash would resolve model names against
  // its parent and 404 on every one.
  if (value) return value.endsWith("/") ? value : `${value}/`;
  return MODEL_ORIGIN;
}

/**
 * The Downloads page's handle on this setting.
 *
 * Handed to the app as a prop, so the shared UI never touches
 * `chrome.storage` and the website — which has nothing to configure —
 * simply passes nothing and renders no such row.
 */
export async function modelSourceSetting() {
  return {
    value: await stored(),
    fallback: MODEL_ORIGIN,
    async save(url) {
      await ext.storage.local.set({ modelOrigin: url });
    },
  };
}
