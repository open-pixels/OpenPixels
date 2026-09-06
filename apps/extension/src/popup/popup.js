/**
 * The popup, which deliberately does almost nothing.
 *
 * A 288-pixel panel is the wrong place to upload a photo, watch a
 * twenty-second job, drag a comparison slider and pick a download folder —
 * and a popup closes the moment the user clicks anywhere else, which would
 * abandon the job. So this offers two doors into the full tab and says what
 * the extension is, and that is all it does.
 *
 * Built with DOM calls rather than one `innerHTML` assignment. The string
 * would be a static literal and therefore safe, but a reviewer — and
 * Mozilla's linter — cannot tell that by looking, and an extension whose
 * whole pitch is "this does not touch your data" should not make anyone
 * check.
 */

const ext = globalThis.browser ?? chrome;

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of [].concat(children)) {
    node.append(child);
  }
  return node;
}

function openApp(hash) {
  ext.tabs.create({ url: ext.runtime.getURL(`app.html${hash}`) });
  window.close();
}

function action(label, className, hash) {
  const button = el("button", { className, textContent: label });
  button.addEventListener("click", () => openApp(hash));
  return button;
}

const hint = el("p", { className: "hint" }, [
  "Or right-click any image on a page and choose ",
  el("em", { textContent: "Enhance this image with OpenPixels" }),
  ".",
]);

document.getElementById("popup").append(
  el("header", {}, [
    el("img", { src: "./icons/icon-48.png", alt: "", width: 28, height: 28 }),
    el("div", {}, [
      el("strong", { textContent: "OpenPixels" }),
      el("span", { textContent: "Free, and nothing is uploaded." }),
    ]),
  ]),
  action("Open a photo", "primary", "#/studio"),
  action("Several at once", "secondary", "#/batch"),
  hint,
  el("footer", {}, [
    action("What this costs", "link", "#/about"),
    action("Downloads", "link", "#/models"),
  ]),
);
