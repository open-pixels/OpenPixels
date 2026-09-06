/**
 * Claiming the image a right-click sent us.
 *
 * The service worker holds the source URL under a one-use token and fetches
 * the bytes itself, because it is the context that can hold host
 * permissions. This page asks for them by token.
 *
 * The awkward case is a site the extension has no permission for. The
 * manifest asks for none at install time — a "read all your data on every
 * website" prompt is a heavy price for a tool most people will use twice,
 * and the research is unambiguous that this audience is wary of exactly
 * that. So permission is requested at the moment it is needed, for the one
 * origin it is needed for, from a click.
 */

const ext = globalThis.browser ?? chrome;

function token() {
  const hash = location.hash ?? "";
  const q = hash.indexOf("?");
  if (q < 0) return null;
  return new URLSearchParams(hash.slice(q + 1)).get("src");
}

/**
 * Returns a promise for `{ file }`, `{ needsPermission, origin, retry }` or
 * null when this page was not opened from a right-click.
 */
export function claimIncoming() {
  const t = token();
  if (!t) return null;
  // Take it out of the address bar: a reload should not look like a second
  // right-click, and the token is single-use anyway.
  history.replaceState(null, "", location.pathname + "#/studio");
  return ask(t);
}

async function ask(t) {
  const reply = await ext.runtime.sendMessage({ type: "openpixels:claim", token: t });
  if (!reply || reply.error === "expired") return null;

  if (reply.error === "fetch-failed" && reply.url) {
    const origin = new URL(reply.url).origin;
    return {
      needsPermission: true,
      origin,
      /**
       * Must be called from a click. `permissions.request` is gated on a
       * user gesture, and calling it from a page-load path fails with
       * "may only be called from a user input handler" — which reads like a
       * bug in the extension rather than a rule about how it was invoked.
       */
      async retry() {
        const granted = await ext.permissions.request({ origins: [`${origin}/*`] });
        if (!granted) return null;
        const res = await fetch(reply.url);
        if (!res.ok) return null;
        const blob = await res.blob();
        return { file: toFile(blob, filenameFrom(reply.url, blob.type)) };
      },
    };
  }

  if (reply.error || !reply.blob) return null;
  return { file: toFile(reply.blob, reply.name) };
}

function toFile(blob, name) {
  return new File([blob], name || "image.png", { type: blob.type });
}

function filenameFrom(url, type) {
  try {
    const base = decodeURIComponent(new URL(url).pathname.split("/").pop() || "");
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
    return `${base || "image"}.${type.split("/")[1]?.split("+")[0] ?? "png"}`;
  } catch {
    return "image.png";
  }
}
