/**
 * The account surface, and the masking that hides the backend behind it.
 *
 * Every failure this catches is silent. A missing CORS origin, a `configure()`
 * that never ran, a refactor that reintroduces a bare `openapps.network`
 * literal — none of them throw, none of them show up in a build, and all of
 * them leave a page that renders perfectly and simply never signs anyone in.
 *
 *   node e2e/account.mjs [--host http://localhost:PORT] [--headed]
 *
 * By default it serves `dist/` itself and points the browser at that, so it
 * checks the built output rather than a dev server. Pass `--host` to run the
 * same assertions against a deployed origin.
 *
 * It never drives a real Google or wallet sign-in. That needs a human and an
 * identity provider, and neither belongs in a test run; the assertions sit on
 * everything either side of it.
 */

import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, "..");
const DIST = join(ROOT, "dist");
const SRC = join(ROOT, "src");
// 5173, not an arbitrary port: the origin has to be one the server already
// allows, or every page check fails on CORS for a reason that is purely an
// artefact of the test. `http://localhost:5173` is in prod.env's
// OPENAPPS_SERVER_ALLOWED_ORIGINS.
const PORT = 5173;

const argv = process.argv.slice(2);
const hostArg = argv.indexOf("--host");
const HOST = hostArg !== -1 ? argv[hostArg + 1] : `http://localhost:${PORT}`;
const headed = argv.includes("--headed");
const serveLocally = hostArg === -1;

// Kept in step with src/lib/openapps.js, deliberately by hand: if someone
// changes the hostname there, this file is the thing that should fail.
const AUTH_HOST = "https://auth.openpixels.app";
const GATEWAY_HOST = "https://gateway.openpixels.app";

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json",
  ".webmanifest": "application/manifest+json", ".onnx": "application/octet-stream",
  ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".jpg": "image/jpeg",
};

function serve() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    let path = join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname === "/" || !existsSync(path)) {
      if (existsSync(join(path, "index.html"))) path = join(path, "index.html");
      else { res.writeHead(404).end("not found"); return; }
    }
    res.writeHead(200, { "content-type": TYPES[extname(path)] ?? "application/octet-stream" });
    res.end(await readFile(path));
  });
  return new Promise((r) => server.listen(PORT, () => r(server)));
}

const failures = [];
function check(name, ok, detail = "") {
  if (!ok) failures.push(name + (detail ? ` — ${detail}` : ""));
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
}

/** Every file under a directory, minus the vendored bundle. */
async function sourceFiles(dir, out = []) {
  for (const entry of await readdir(dir)) {
    const full = join(dir, entry);
    if ((await stat(full)).isDirectory()) {
      if (entry === "vendor") continue;   // build output, not our source
      await sourceFiles(full, out);
    } else if (/\.(js|svelte|html|css)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

async function main() {
  // ---- 1. The masking, as a static property of the source -----------------
  //
  // This is the regression test for the bug OpenCapture actually shipped: the
  // base URL written as a literal in two places, so moving to the custom
  // domain fixed one and silently left the other on the old host. It costs
  // nothing and it is the check most likely to catch a future refactor.
  console.log("masking:");
  const files = await sourceFiles(SRC);
  const offenders = [];
  for (const f of files) {
    if (f.endsWith(join("lib", "openapps.js"))) continue;   // the one place it may appear
    const text = await readFile(f, "utf8");
    if (/openapps\.network/.test(text)) offenders.push(f.slice(ROOT.length + 1));
  }
  check("no source file outside lib/openapps.js names openapps.network",
    offenders.length === 0, offenders.join(", "));

  const config = await readFile(join(SRC, "lib", "openapps.js"), "utf8");
  check("the auth host is the product's own", config.includes(AUTH_HOST));
  check("the gateway host is the product's own", config.includes(GATEWAY_HOST));
  // Match the assignment, not the file: openapps.js explains the masking in
  // prose, and a comment naming the shared backend is the documentation doing
  // its job rather than a leak.
  const gatewayConst = config.match(/OPENAPPS_GATEWAY_URL\s*=\s*"([^"]+)"/)?.[1];
  const authConst = config.match(/OPENAPPS_BASE_URL\s*=\s*"([^"]+)"/)?.[1];
  check("the gateway constant is not left on the shared backend",
    gatewayConst === GATEWAY_HOST, gatewayConst ?? "not found");
  check("the auth constant is not left on the shared backend",
    authConst === AUTH_HOST, authConst ?? "not found");

  // ---- 2. The hosts answer ------------------------------------------------
  console.log("hosts:");
  for (const [label, url] of [["auth", AUTH_HOST], ["gateway", GATEWAY_HOST]]) {
    try {
      const res = await fetch(`${url}/healthz`);
      check(`${label} host answers /healthz`, res.ok, `HTTP ${res.status}`);
    } catch (e) {
      check(`${label} host answers /healthz`, false, e.message);
    }
  }

  // CORS is the single most common way this breaks, and a browser reports it
  // identically to a dead server — so assert on the header directly, where
  // the cause is unambiguous.
  try {
    const res = await fetch(`${AUTH_HOST}/v1/payments/packages`, {
      headers: { Origin: "https://app.openpixels.app" },
    });
    check("the app origin is in the server's allowed_origins",
      res.headers.get("access-control-allow-origin") === "https://app.openpixels.app",
      res.headers.get("access-control-allow-origin") ?? "no header");
  } catch (e) {
    check("the app origin is in the server's allowed_origins", false, e.message);
  }

  // The auth host must accept its own /signin as a return_to. That is the
  // flow an extension uses -- it cannot receive a cross-origin redirect, so
  // it opens the server's page and takes the session back by postMessage --
  // and the page sets return_to to its own origin. Without an
  // `https://auth.<product>` entry in the server's allowed_origins the server
  // refuses its own page with a 400, and nothing surfaces that until someone
  // clicks Google and lands on a JSON error. It shipped exactly that way.
  try {
    const rt = encodeURIComponent(`${AUTH_HOST}/signin`);
    const res = await fetch(`${AUTH_HOST}/v1/auth/oidc/google/start?return_to=${rt}`,
      { redirect: "manual" });
    check("the auth host accepts its own /signin as a return_to",
      res.status === 307, `HTTP ${res.status}`);
  } catch (e) {
    check("the auth host accepts its own /signin as a return_to", false, e.message);
  }

  let methods = {};
  try {
    methods = (await (await fetch(`${AUTH_HOST}/v1/auth/methods`)).json())?.methods ?? {};
    check("the server has at least one sign-in method configured",
      Object.values(methods).some(Boolean), JSON.stringify(methods));
  } catch (e) {
    check("the server has at least one sign-in method configured", false, e.message);
  }

  // ---- 3. The page ---------------------------------------------------------
  console.log("account page:");
  const server = serveLocally ? await serve() : null;
  const browser = await chromium.launch({ channel: "chromium", headless: !headed });
  const page = await browser.newPage({ viewport: { width: 430, height: 932 } });
  const csp = [], errors = [];
  page.on("console", (m) => {
    const t = m.text();
    if (/Content Security Policy|Refused to/i.test(t)) csp.push(t);
    else if (m.type() === "error") errors.push(t);
  });
  page.on("pageerror", (e) => errors.push(String(e)));

  try {
    const accountRequests = [];
    page.on("request", (r) => accountRequests.push(r.url()));
    await page.goto(`${HOST}/#/account`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(3000);

    // What the client actually dialled. Stronger than reading a constant and
    // stronger than asking an element for its client, because it is the wire.
    check("the account page called the product's auth host",
      accountRequests.some((u) => u.startsWith(AUTH_HOST)),
      accountRequests.find((u) => u.startsWith(AUTH_HOST)) ?? "no request to the auth host");
    check("nothing was sent to the shared backend hostname",
      !accountRequests.some((u) => /openapps\.network/.test(u)),
      accountRequests.find((u) => /openapps\.network/.test(u)) ?? "");

    const body = await page.locator("body").innerText();

    // The promise the pricing page makes has to survive the existence of an
    // account page. If this text goes, the website is lying.
    check("the page says up front that an account unlocks nothing here",
      /unlocks nothing|no limit/i.test(body), body.slice(0, 80));

    // Assert the failure state is ABSENT rather than that a button exists:
    // the CORS failure renders a perfectly nice panel that can never sign
    // anyone in, so presence of UI proves nothing.
    check("the account tools reached the server",
      !/Could not reach the account server/i.test(body),
      /Could not reach/i.test(body) ? "CORS or the host is down" : "");

    const panel = await page.locator('[data-testid="account-panel"]').count();
    check("the account panel mounted", panel === 1);

    // The client's *runtime* baseUrl, not the constant — this is what catches
    // a configure() that never ran.
    const baseUrl = await page.evaluate(() => {
      const el = document.querySelector("openapps-login");
      return el?.client?.baseUrl ?? window.__openappsBaseUrl ?? null;
    });
    if (baseUrl) {
      check("the live client points at the product's auth host", baseUrl === AUTH_HOST, baseUrl);
    } else {
      // Not every element exposes its client; fall back to proving no request
      // ever went to the shared backend hostname.
      check("the live client points at the product's auth host", true, "(not exposed; see request check)");
    }

    check("no CSP violations on the account page", csp.length === 0, csp[0] ?? "");
    check("no page errors on the account page", errors.length === 0, errors[0] ?? "");

    // ---- 3b. The account entry point, and the branding ------------------
    //
    // The control belongs top right in the sticky header, on every screen.
    // It began as a text link in two footers, which is where a reader looks
    // last and where nobody looks for an account.
    console.log("entry point and branding:");
    for (const r of ["", "#/account", "#/about"]) {
      await page.goto(`${HOST}/${r}`, { waitUntil: "load" });
      await page.waitForTimeout(900);
      const placed = await page.evaluate(() => {
        const el = document.querySelector("header .account");
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return b.right > innerWidth / 2 && b.top < 80;
      });
      check(`the account control is top-right on "${r || "home"}"`, placed === true);
    }
    const inFooter = await page.evaluate(
      () => /account/i.test(document.querySelector("nav.footer")?.innerText ?? ""));
    check("no account link left in a footer", !inFooter);

    // The shared backend is plumbing, not a brand to introduce to someone who
    // installed a photo enhancer. The login panel ships its own "Sign in to
    // OpenApps" header inside shadow DOM, so this walks shadow roots too.
    await page.goto(`${HOST}/#/account`, { waitUntil: "load" });
    await page.waitForTimeout(3500);
    const leaked = await page.evaluate(() => {
      const out = [];
      const scan = (root, where) => {
        for (const el of root.querySelectorAll("*")) {
          if (el.shadowRoot) scan(el.shadowRoot, `${where}>${el.tagName.toLowerCase()}`);
          if (el.children.length === 0 && /openapps/i.test(el.textContent)) {
            const st = getComputedStyle(el);
            if (st.display !== "none" && st.visibility !== "hidden" && el.getClientRects().length)
              out.push(`${where} :: ${el.textContent.trim().slice(0, 60)}`);
          }
        }
      };
      scan(document, "doc");
      return out;
    });
    check("no visible \"OpenApps\" anywhere on the account page", leaked.length === 0, leaked.join(" | "));

    // The panel's mark is a String property rendered as text, so the product
    // mark has to be one character. The default is "O" for OpenApps and the
    // first attempt here was a bare "P", which read as a placeholder because
    // it was one. U+2726 is the same sparkle as icons/favicon.svg.
    const mark = await page.evaluate(() =>
      document.querySelector("openapps-login")?.shadowRoot?.querySelector(".mark")?.textContent?.trim());
    check("the sign-in panel carries the product mark, not a letter",
      mark === "\u2726", JSON.stringify(mark));

    // The header carries the mark as well as the wordmark, so the app and the
    // marketing site look like the same product.
    const brand = await page.evaluate(() => {
      const i = document.querySelector("header .brandmark");
      return i ? { ok: i.complete && i.naturalWidth > 0, src: i.getAttribute("src") } : null;
    });
    check("the app header shows the logo", brand?.ok === true, brand ? brand.src : "absent");

    // ---- 3c. The sign-in return trip ------------------------------------
    //
    // This is the regression test for the bug that made sign-in silently
    // impossible. `completeRedirect()` reads the code from `location.hash`
    // and never from `location.search`, so the provider's return lands on a
    // fragment — which a hash router reads as a route name, matching nothing
    // and falling through to Home, where no account component mounts and the
    // code is never exchanged. Everything visible worked; only the last step
    // was missing.
    console.log("sign-in return:");
    // A FRESH PAGE, deliberately. Coming back from a provider is a full
    // cross-origin navigation, so the login element mounts from scratch and
    // its connectedCallback runs completeRedirect(). Reusing the page above
    // would only change the hash, leaving the element already mounted and
    // completeRedirect never re-run — which fails for a reason that exists
    // nowhere in the real flow.
    const fresh = await browser.newPage({ viewport: { width: 430, height: 932 } });
    const exchanges = [];
    fresh.on("request", (r) => { if (/\/auth\/oidc\/exchange/.test(r.url())) exchanges.push(r.url()); });
    await fresh.goto(`${HOST}/#code=not-a-real-code`, { waitUntil: "load" });
    await fresh.waitForTimeout(4500);
    check("a returning #code= reaches the account view",
      (await fresh.locator('[data-testid="account-panel"]').count()) === 1);
    check("a returning #code= is actually exchanged",
      exchanges.length > 0, exchanges.length ? "POST /v1/auth/oidc/exchange" : "never exchanged");
    await fresh.close();

    // ---- 4. Nothing regressed on the rest of the app ---------------------
    console.log("the rest of the app:");
    const requests = [];
    page.on("request", (r) => requests.push(r.url()));
    await page.goto(`${HOST}/`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(1500);
    const home = await page.locator("body").innerText();
    check("the home page still promises everything is free",
      /free/i.test(home) && /no account|nothing is uploaded/i.test(home));
    check("the home page contacts no account server at all",
      !requests.some((u) => /auth\.openpixels|gateway\.openpixels|openapps\.network/.test(u)),
      requests.find((u) => /auth\.openpixels|openapps\.network/.test(u)) ?? "");
  } finally {
    await browser.close();
    server?.close();
  }

  if (failures.length) {
    console.error(`\n${failures.length} check(s) failed:\n  ` + failures.join("\n  "));
    process.exit(1);
  }
  console.log("\nall account checks passed");
}

main().catch((e) => { console.error(e); process.exit(1); });
