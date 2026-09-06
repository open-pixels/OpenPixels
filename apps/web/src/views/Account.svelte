<script>
  /*
    The account page.

    THIS PAGE UNLOCKS NOTHING, AND SAYS SO FIRST.

    Every other product in the suite has an account because it has something
    to sell: OpenCapture gates a watermark, OpenPdfEdit gates OCR. Both do
    work on a server that costs money per use. OpenPixels does not — every
    model runs on the visitor's own device — so there is nothing here to
    meter and nothing to withhold, and an account is purely a way to carry a
    balance to the apps where there *is* something to pay for.

    Someone arriving on a page headed "Account" in a product whose pricing
    page says "there is no account, no trial, no credit" is entitled to think
    the promise just broke. So the first thing on the page is the reason it
    has not, before any button.

    WHY THIS IS ITS OWN ROUTE AND NOT A PANEL OVER THE STUDIO

    <openapps-login>'s Google button is a full-page redirect out to
    accounts.google.com and back. Mounted over the Studio it would reload the
    app and throw away the photo being worked on — OpenPdfEdit hit exactly
    this and had to move sign-in into a separate window. Here the account page
    is its own screen with no state worth losing, so the plain redirect is
    fine and no popup dance is needed.

    The bundle is imported dynamically. It is ~360 KB of components that
    someone who never opens this page should never download, and the home
    page's whole argument is that it is small.
  */
  import { t } from "$lib/i18n.js";
  import Icon from "$ui/Icon.svelte";
  import { ensureConfigured, OPENAPPS_BASE_URL } from "$lib/openapps.js";

  let { go } = $props();

  let state = $state("loading"); // loading | ready | failed

  $effect(() => {
    let cancelled = false;
    ensureConfigured()
      .then(() => !cancelled && (state = "ready"))
      .catch(() => !cancelled && (state = "failed"));
    return () => (cancelled = true);
  });
</script>

<div class="stack-lg">
  <div>
    <h1>{$t("account.title")}</h1>
    <p class="lead big">{$t("account.lede")}</p>
  </div>

  <!--
    Stated before the sign-in button, not after it. This is the paragraph
    that keeps the pricing page honest.
  -->
  <div class="card stack">
    <section>
      <h3><Icon name="check" size={16} /> {$t("account.free.title")}</h3>
      <p>{$t("account.free.body")}</p>
    </section>
    <section>
      <h3><Icon name="shield" size={16} /> {$t("account.private.title")}</h3>
      <p>{$t("account.private.body")}</p>
    </section>
  </div>

  {#if state === "loading"}
    <p class="muted">{$t("account.loading")}</p>
  {:else if state === "failed"}
    <!--
      The honest failure. The overwhelmingly common cause is CORS — this
      origin missing from the server's allowed_origins — which a browser
      reports identically to a dead server, so the message names both and
      does not guess.
    -->
    <div class="card">
      <h3>{$t("account.offline.title")}</h3>
      <p>{$t("account.offline.body")}</p>
      <p class="muted small">{OPENAPPS_BASE_URL}</p>
    </div>
  {:else}
    <div class="card stack" data-testid="account-panel">
      <openapps-login variant="panel"></openapps-login>
      <openapps-credits poll-seconds="30"></openapps-credits>
      <openapps-account></openapps-account>
      <openapps-buy></openapps-buy>
      <!--
        Unscoped deliberately. The balance is shared across every OpenApps
        app, so filtering to this one would leave someone looking at a
        number that dropped for reasons this page refuses to name.
      -->
      <openapps-history></openapps-history>
      <openapps-signout></openapps-signout>
    </div>
  {/if}

  <nav class="footer">
    <button class="inline" onclick={() => go("home")}>{$t("nav.home")}</button>
    <button class="inline" onclick={() => go("about")}>{$t("nav.about")}</button>
  </nav>
</div>

<style>
  /*
    The elements bring their own shadow-DOM styling from the shared design
    tokens; all this does is give them room and a consistent rhythm with the
    rest of the app.
  */
  openapps-login,
  openapps-credits,
  openapps-account,
  openapps-buy,
  openapps-history,
  openapps-signout {
    display: block;
  }
  .small {
    font-size: 0.85em;
    word-break: break-all;
  }
</style>
