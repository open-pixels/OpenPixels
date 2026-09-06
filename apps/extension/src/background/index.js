/**
 * The service worker: a context menu, and a place to put an image while a
 * tab opens to work on it.
 *
 * The research (§八 ④) concluded that no competitor ships a browser
 * extension and that this is "unfilled for a reason" — the flow needs an
 * upload, a progress display, a comparison and a download, none of which
 * fit a popup the size of a business card. That reasoning is right about
 * *popups*, so this extension does not put the work in one. The popup is a
 * door; the work happens in a full extension tab that hosts the same app
 * the website serves, at whatever size the window is.
 *
 * What the extension adds over the website is the one thing a website
 * cannot do: start from an image already on a page, without the round trip
 * of save-then-upload.
 */

const ext = globalThis.browser ?? chrome;
const MENU_ID = "openpixels-enhance";

/**
 * Images waiting for their tab to open and ask for them.
 *
 * A service worker can be evicted between the click and the tab's request,
 * which would strand the image, so this is also mirrored into
 * `storage.session` — memory for the common case, storage for the eviction.
 */
const inbox = new Map();

ext.runtime.onInstalled.addListener(() => {
  // `removeAll` first: an update that re-runs this would otherwise fail with
  // "duplicate id" and leave no menu at all.
  ext.contextMenus.removeAll(() => {
    ext.contextMenus.create({
      id: MENU_ID,
      title: ext.i18n.getMessage("contextMenu"),
      contexts: ["image"],
    });
  });
});

ext.contextMenus.onClicked.addListener(async (info) => {
  if (info.menuItemId !== MENU_ID || !info.srcUrl) return;
  await open(info.srcUrl);
});

async function open(srcUrl) {
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  inbox.set(token, srcUrl);
  try {
    await ext.storage.session.set({ [`inbox:${token}`]: srcUrl });
  } catch {
    // Firefox before 115 has no session storage; the in-memory map covers
    // the case where the worker survives, which it usually does.
  }
  await ext.tabs.create({ url: ext.runtime.getURL(`app.html#/studio?src=${token}`) });
}

ext.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "openpixels:claim") return;

  // Only our own pages may claim. A page on the open web cannot reach this
  // listener at all without `externally_connectable`, which is not set, but
  // checking the sender's origin whole keeps that true if it ever is.
  const senderOrigin = sender.url ? new URL(sender.url).origin : "";
  if (senderOrigin !== new URL(ext.runtime.getURL("app.html")).origin) {
    sendResponse({ error: "not permitted" });
    return;
  }

  claim(message.token).then(sendResponse);
  return true; // an async sendResponse
});

async function claim(token) {
  let url = inbox.get(token);
  if (!url) {
    try {
      const stored = await ext.storage.session.get(`inbox:${token}`);
      url = stored[`inbox:${token}`];
    } catch {
      // Fall through to the not-found answer.
    }
  }
  if (!url) return { error: "expired" };

  // One claim per token: the app tab has the bytes after this, and leaving
  // the URL behind would keep a record of what someone enhanced.
  inbox.delete(token);
  ext.storage.session.remove(`inbox:${token}`).catch(() => {});

  /*
    Fetched here rather than in the app page, because this is the context
    that can hold host permissions. It is also the only network request this
    extension ever makes to a site: it retrieves the image the user
    right-clicked, from the page they were already on, and hands back bytes.
    Nothing is sent anywhere.
  */
  try {
    const res = await fetch(url);
    if (!res.ok) return { error: `${res.status} ${res.statusText}` };
    const blob = await res.blob();
    if (!blob.type.startsWith("image/")) return { error: "not an image" };
    // A Blob survives structured clone to an extension page.
    return { blob, name: filename(url, blob.type) };
  } catch (e) {
    // The usual cause is a host the extension has no permission for, which
    // is a question for the app page to ask the user, not an error.
    return { error: "fetch-failed", url, message: String(e?.message ?? e) };
  }
}

function filename(url, type) {
  try {
    const path = new URL(url).pathname;
    const base = decodeURIComponent(path.split("/").pop() || "");
    if (base && /\.[a-z0-9]{2,5}$/i.test(base)) return base;
    const ext = type.split("/")[1]?.split("+")[0] ?? "png";
    return `${base || "image"}.${ext}`;
  } catch {
    return "image.png";
  }
}
