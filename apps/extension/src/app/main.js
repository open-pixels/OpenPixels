/**
 * The extension's app page: the same Svelte app the website serves, in a
 * full tab.
 *
 * Two differences from the web build, and only two:
 *
 *  1. **Models come from the website.** An extension cannot carry half a
 *     gigabyte of weights through a store review, and Chrome forbids fetching *code*
 *     from a remote origin — which is why the wasm core and the ONNX
 *     runtime are bundled, and only the weights, which are data, are not.
 *     The image still never goes anywhere.
 *  2. **A photo can arrive from a right-click**, claimed from the service
 *     worker by the token in the URL.
 */

import "$tokens/css/colors.css";
import "$tokens/css/typography.css";
import "$tokens/css/spacing.css";
import "$tokens/css/platform.css";
import "$tokens/css/radius.css";
import "$tokens/css/elevation.css";
import "$tokens/css/motion.css";
import "$tokens/css/base.css";
import "$web/fonts.css";
import "$web/app.css";

import { mount } from "svelte";
import App from "$web/App.svelte";
import { claimIncoming } from "./incoming.js";
import { modelOrigin, modelSourceSetting } from "./model-origin.js";

/*
  Both are read from storage before mounting, because the app configures its
  worker on the first frame and a late change would leave the worker looking
  for models somewhere else.
*/
const [origin, modelSource] = await Promise.all([modelOrigin(), modelSourceSetting()]);

mount(App, {
  target: document.getElementById("app"),
  props: {
    modelOrigin: origin,
    modelSource,
    // Resolved before the app decides which screen to show, so a
    // right-clicked image lands in the Studio rather than flashing the home
    // page first.
    incoming: claimIncoming(),
  },
});
