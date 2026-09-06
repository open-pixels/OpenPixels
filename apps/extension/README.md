# OpenPixels for Chrome, Edge and Firefox

Right-click any image on the web and enhance it, without uploading it.

## What is here

This package is thin on purpose. It bundles `apps/web/src` through a Vite
alias, so the Studio, the Batch screen, the strings and the whole engine are
the website's — there is one of each, not two that drift apart. Only three
files are the extension's own:

| | |
|---|---|
| `src/background/index.js` | The context menu, and the fetch that needs host permissions. |
| `src/popup/` | A door into the full tab. It does no image work; see below. |
| `src/app/` | The app entry, supplying the model origin and the right-click handoff. |

## Why the popup does almost nothing

The market research this project answers concluded that no competitor ships
an extension because the flow — upload, watch a long job, compare, download
— does not fit a popup. That is correct about popups, and a popup also
*closes the moment you click anywhere else*, which would abandon the job.

So the popup opens a tab, and the tab hosts the full application at whatever
size the window is. What the extension adds over the website is the one
thing a website cannot do: start from an image already on a page.

## Permissions

At install: `contextMenus` and `storage`. **No host permissions.** A "read
all your data on every website" prompt at install is a heavy price for a
tool most people will use twice.

When you right-click an image on a site the extension has not seen before,
the app shows a button asking for that one origin. That is also the only way
it can work — `permissions.request` requires a user gesture, and calling it
from a page-load path fails with an error that reads like a bug rather than
a rule.

## Models

Weights are fetched from `https://openpixels.app/models/` on first use and
cached on the device. A store package cannot carry half a gigabyte, and Chrome
forbids fetching *code* from a remote origin — which is why the wasm core
and the ONNX runtime are bundled and only the weights, which are data, are
not.

Point it somewhere else if you would rather not depend on that host: the
extension's **Downloads** page has a field for it. The checksums are in
`MODELS.md`, so a self-hosted copy is verifiable against the same pins the
build uses. Delete a downloaded model after changing the address and it is
re-fetched from the new one.

## Build

```sh
npm install
npm run build          # -> dist/          (Chrome, Edge)
npm run build:firefox  # -> dist-firefox/
npm run build:all
npm run e2e            # loads dist/ into a real Chromium and runs a real upscale
```

`npm run build` also runs `check-manifest.mjs`, which refuses to emit a
package a browser would not load. The Firefox build additionally runs
`web-ext lint` — Mozilla's own validator — and fails on any error.

It reports **four warnings that cannot be fixed here**, and a reviewer
should expect them:

| Warning | Where | Why it stays |
|---|---|---|
| `UNSAFE_VAR_ASSIGNMENT` (innerHTML) | `app.js` | Svelte compiles static markup to a template `innerHTML`. The strings are compile-time constants. |
| `UNSAFE_VAR_ASSIGNMENT` (dynamic import) | the two `ort.*.min.js` chunks | onnxruntime picks its own runtime file at load. |
| `DANGEROUS_EVAL` | `ort-wasm-simd-threaded.asyncify.mjs` | Emscripten's glue uses the `Function` constructor. Unavoidable in any build that runs ONNX models. |

There are zero errors, and no dynamic value reaches any of them.

Load it unpacked from `chrome://extensions` (Developer mode → Load unpacked
→ `dist/`), or in Firefox from `about:debugging` → This Firefox → Load
Temporary Add-on → `dist-firefox/manifest.json`.
