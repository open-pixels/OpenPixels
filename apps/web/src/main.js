/* Token layers, imported individually so this build substitutes its own
   font declarations for the shared file's — see src/fonts.css. */
import "$tokens/css/colors.css";
import "$tokens/css/typography.css";
import "$tokens/css/spacing.css";
import "$tokens/css/platform.css";
import "$tokens/css/radius.css";
import "$tokens/css/elevation.css";
import "$tokens/css/motion.css";
import "$tokens/css/base.css";
import "./fonts.css";
import "./app.css";

import { mount } from "svelte";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app") });
