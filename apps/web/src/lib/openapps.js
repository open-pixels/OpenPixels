/**
 * The OpenApps account integration: where it talks to, and what it does not do.
 *
 * WHAT AN ACCOUNT IS FOR HERE, AND WHAT IT IS NOT FOR
 *
 * It gates nothing. Every OpenPixels feature runs on the user's own device,
 * which costs us nothing per photo, so there is nothing to meter and nothing
 * to withhold — that is the product's whole argument for being free, and an
 * account does not change it. Signing in is optional and does exactly one
 * thing: it carries an OpenApps balance that other apps in the suite (where
 * there *is* server-side work to pay for) can spend.
 *
 * So there is no app key anywhere in this app, no `charge` call, and no
 * entitlement check. If a paid feature is ever added here, it belongs behind
 * openapps-gateway, and the copy on the website has to change with it.
 *
 * ONE PLACE FOR EVERY URL
 *
 * OpenCapture learned this expensively: its base URL was written as a literal
 * in two places, so moving to the custom domain fixed one and silently left
 * the other pointing at the old host. Everything below is defined once and
 * imported. A grep for `openapps.network` anywhere else in `src/` should
 * return nothing, and the e2e suite asserts exactly that.
 */

/**
 * The shared OpenApps backend, under an OpenPixels name.
 *
 * Same box, same service, same account and credit ledger as
 * `accounts.openapps.network`. Sessions are bearer tokens rather than
 * cookies, so nothing about identity is domain-scoped and a second hostname
 * pointed at the same backend changes nothing functionally.
 *
 * It exists so that signing in never shows a stranger's domain to someone who
 * has only ever heard of OpenPixels.
 *
 * WHAT THIS DOES NOT HIDE. The server builds these once at startup from its
 * own `public_url`, not per request, so they still name the backend:
 * Google sign-in visibly bounces through `accounts.openapps.network` on the
 * OAuth callback hop, and a wallet signature prompt names that host. Neither
 * is a security property — the server never checks either string against the
 * request — but neither is fixed by adding a hostname, so do not describe the
 * masking as more complete than it is.
 */
export const OPENAPPS_BASE_URL = "https://auth.openpixels.app";

/**
 * openapps-gateway, which holds the app key that turns a user's token into an
 * actual charge. Unused by this app today — nothing here is chargeable — and
 * named anyway so that the day something is, the URL is already in the one
 * place URLs live, rather than being pasted in as a literal.
 *
 * Masked for a sharper reason than the auth host: a browser permission prompt
 * names whichever host is asked for, and "OpenPixels wants to communicate
 * with gateway.openapps.network" reads like the app is talking to someone
 * else's server.
 */
export const OPENAPPS_GATEWAY_URL = "https://gateway.openpixels.app";

/** The SDK's own default session key, restated so callers can watch for it. */
export const SESSION_STORAGE_KEY = "openapps.session";

/**
 * Is this page load the tail end of a sign-in?
 *
 * THE WHOLE "I CANNOT SIGN IN" BUG LIVED HERE.
 *
 * The session is only ever picked up by the SDK's `completeRedirect()`, which
 * runs from the login component's `connectedCallback`. Called with no
 * arguments — which is how the component calls it — it looks for the code in
 * `location.hash` and **nowhere else**; it never reads `location.search`.
 *
 * So the provider sends the browser back to `https://app.openpixels.app/#code=…`,
 * and this app is a hash router. It read `code=…` as a route name, matched
 * nothing, and fell through to Home — where no account component mounts, so
 * `completeRedirect()` was never called and the code sat unread in the address
 * bar. Every visible part of the flow worked: the redirect out, Google, the
 * redirect back. Only the last step was missing, and it failed silently.
 *
 * Hence: detect the return *before* the router picks a view.
 *
 * `?account=1` is a second, unrelated entry point — a plain link to the
 * account screen that survives the server's "return_to must not contain a
 * fragment" rule. It is not how a sign-in comes back.
 */
export function isSignInReturn(hash = location.hash, search = location.search) {
  const inHash = new URLSearchParams(hash.replace(/^#/, ""));
  if (inHash.has("code")) return true;
  return new URLSearchParams(search).has("account");
}

/**
 * The provider's code arrives in the fragment, and the SDK deletes it once it
 * has been exchanged. That empties the hash, which fires `hashchange`, which
 * would send a just-signed-in visitor back to Home. Callers use this to keep
 * the account view put across that one transition.
 */
export function isConsumedSignInReturn(hash = location.hash) {
  return hash === "" || hash === "#";
}


let configured = false;

/**
 * Point the shared client at our host. Idempotent, because the account view
 * can be mounted more than once in a session.
 *
 * Imported for its side effects as well as its exports: loading the bundle is
 * what registers `<openapps-login>` and friends as custom elements.
 */
export async function ensureConfigured() {
  if (configured) return;
  // The shared design tokens the elements style themselves from. Loaded
  // here rather than in the app's entry point so that a visitor who never
  // opens the account page never fetches it.
  await import("../vendor/openapps/tokens.css");
  const { configure } = await import("../vendor/openapps/openapps-ui.js");
  configure({ baseUrl: OPENAPPS_BASE_URL });
  configured = true;
}

/**
 * Subscribe to sign-in and sign-out. Returns an unsubscribe.
 *
 * The elements each carry their own signed-out placeholder — four separate
 * "Sign in to …" lines, stacked, under a panel that already says it. The
 * account page uses this to mount them only once there is a session.
 */
export async function onSessionChange(fn) {
  await ensureConfigured();
  const { onChange } = await import("../vendor/openapps/openapps-ui.js");
  return onChange(fn);
}

/** Is there a session right now? */
export async function isSignedIn() {
  const c = await client();
  return c?.isLoggedIn ?? false;
}

/** The live client, or null before {@link ensureConfigured} has run. */
export async function client() {
  await ensureConfigured();
  const { getClient } = await import("../vendor/openapps/openapps-ui.js");
  return getClient();
}
