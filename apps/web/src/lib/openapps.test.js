/**
 * The sign-in return trip.
 *
 * `npm test` ran zero test files before this one: vitest was installed and
 * nothing used it, so the command failed and the dependency was dead weight
 * in every clone. These are the pure functions worth having it for — the
 * pair that decides, before the router picks a view, whether a page load is
 * the tail end of a sign-in.
 *
 * They encode a bug that shipped. In a hash-routed app the provider comes
 * back to `/#code=…`; the router read `code=…` as a route name, matched
 * nothing, fell through to Home, and no account component ever mounted — so
 * the SDK's `completeRedirect()`, which reads `location.hash` and nowhere
 * else, was never called. Every visible step worked and the last one
 * silently did not happen.
 */
import { describe, it, expect } from "vitest";
import {
  isSignInReturn,
  isConsumedSignInReturn,
  OPENAPPS_BASE_URL,
  OPENAPPS_GATEWAY_URL,
} from "./openapps.js";

describe("isSignInReturn", () => {
  it("recognises the provider's code in the fragment", () => {
    expect(isSignInReturn("#code=abc123", "")).toBe(true);
  });

  it("recognises it alongside other fragment parameters", () => {
    expect(isSignInReturn("#state=xyz&code=abc123", "")).toBe(true);
  });

  it("recognises the ?account entry point, which is a different door", () => {
    expect(isSignInReturn("", "?account=1")).toBe(true);
    // The server refuses a `return_to` carrying a fragment, so this is the
    // form a plain link to the account screen has to take.
    expect(isSignInReturn("#/studio", "?account=1")).toBe(true);
  });

  it("leaves an ordinary route alone", () => {
    expect(isSignInReturn("#/studio", "")).toBe(false);
    expect(isSignInReturn("#/about", "")).toBe(false);
    expect(isSignInReturn("", "")).toBe(false);
  });

  it("does not mistake a route whose name merely contains 'code'", () => {
    // `#/models` and friends are parsed as query parameters here, so a
    // route must not be read as a key. This is the failure that started
    // the whole bug: a fragment treated as something it is not.
    expect(isSignInReturn("#/decode", "")).toBe(false);
    expect(isSignInReturn("#/qrcode", "")).toBe(false);
  });

  it("ignores a code in the query string, because the SDK does", () => {
    // Deliberate, and the first wrong turn taken while fixing this:
    // `completeRedirect()` reads the fragment only. Claiming a return here
    // would route to the account view and then exchange nothing.
    expect(isSignInReturn("", "?code=abc123")).toBe(false);
  });
});

describe("isConsumedSignInReturn", () => {
  it("is true once the SDK has emptied the fragment", () => {
    // The SDK deletes the code after exchanging it. That fires
    // `hashchange` with an empty hash, which would otherwise bounce a
    // just-signed-in visitor back to Home.
    expect(isConsumedSignInReturn("")).toBe(true);
    expect(isConsumedSignInReturn("#")).toBe(true);
  });

  it("is false while a route is present", () => {
    expect(isConsumedSignInReturn("#/account")).toBe(false);
    expect(isConsumedSignInReturn("#code=abc")).toBe(false);
  });
});

describe("the account hosts", () => {
  it("are the product's own, on https", () => {
    // Stated as what the hostnames must *be*, not as what they must not
    // contain. `account.mjs` greps the whole source tree for the backend
    // host and allows it in exactly one file — so a test that named it in
    // order to assert its absence would fail that grep, which is the check
    // doing its job. Pinning the expected hostname is the stronger
    // assertion anyway: it fails on any wrong host, not just one.
    expect(new URL(OPENAPPS_BASE_URL).hostname).toBe("auth.openpixels.app");
    expect(new URL(OPENAPPS_GATEWAY_URL).hostname).toBe("gateway.openpixels.app");
    for (const url of [OPENAPPS_BASE_URL, OPENAPPS_GATEWAY_URL]) {
      expect(new URL(url).protocol).toBe("https:");
    }
  });
});
