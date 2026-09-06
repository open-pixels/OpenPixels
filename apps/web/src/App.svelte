<script>
  import { t, lang, LANGUAGES } from "$lib/i18n.js";
  import { configure } from "$lib/engine/client.js";
  import { cachedModels } from "$lib/engine/models.js";
  import Icon from "$ui/Icon.svelte";
  import Home from "$views/Home.svelte";
  import Studio from "$views/Studio.svelte";
  import Batch from "$views/Batch.svelte";
  import Models from "$views/Models.svelte";
  import About from "$views/About.svelte";
  import Account from "$views/Account.svelte";
  import { isSignInReturn, isConsumedSignInReturn } from "$lib/openapps.js";

  /*
    `incoming` is how a host hands this app a photo it already has. The web
    build never passes one; the extension passes a promise that resolves to
    the image a right-click sent, or to a request for permission on the site
    it came from. Kept as a prop rather than read from the environment so
    this component has no idea an extension exists.
  */
  let { modelOrigin = null, incoming = null, modelSource = null } = $props();

  /*
    A hash router in twenty lines rather than a routing library. Five
    screens, one of which holds all the state; anything more is a dependency
    to keep current for no benefit.
  */
  /*
    The sign-in return overrides the hash.

    A provider sends the browser back to `/?code=...` — a query, because the
    server refuses a `return_to` containing a fragment, and this app's own
    URLs are all fragments. So the returning page has no hash at all and
    would otherwise render Home, where nothing account-related mounts and the
    code in the address bar is never exchanged. That was the "I cannot sign
    in" bug, and it is fixed here rather than in the account view, because by
    the time a view is chosen it is already too late.
  */
  let route = $state(isSignInReturn() ? "account" : parse(location.hash));
  function parse(hash) {
    const name = hash.replace(/^#\/?/, "").split("/")[0];
    return name || "home";
  }
  function go(name) {
    location.hash = `#/${name}`;
  }

  /*
    One transition needs holding: the SDK deletes the provider's code from the
    fragment the moment it exchanges it, which empties the hash and fires
    `hashchange`. Following that would drop a visitor who has just signed in
    back onto Home. So the first empty hash after a sign-in return is
    rewritten to this view rather than followed.
  */
  let holdAccount = $state(isSignInReturn());
  $effect(() => {
    const on = () => {
      // A code can also arrive by hash change rather than a fresh load.
      // Coming back from a provider is a full navigation, so the startup
      // check is the one that normally fires — but an in-page hash change
      // carrying a code must not be read as a route name and dropped.
      if (isSignInReturn()) {
        holdAccount = true;
        route = "account";
        return;
      }
      if (holdAccount && isConsumedSignInReturn()) {
        holdAccount = false;
        location.hash = "#/account";
        return;
      }
      holdAccount = false;
      route = parse(location.hash);
    };
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  });

  // Warms the worker and the wasm module while the visitor reads the home
  // page, so the first press of Enhance is not also a cold start. Read
  // inside an effect because `modelOrigin` is a prop: the extension host
  // passes one, the web build does not, and the worker is configured once
  // either way.
  $effect(() => {
    configure(modelOrigin ? { modelOrigin } : {}).catch(() => {});
  });

  let picked = $state(null);
  function pick(file) {
    picked = file;
    go("studio");
  }

  /*
    A photo passed in by the host. `needsPermission` is the case where the
    image is on a site the host cannot read yet — the app shows a button,
    because the browser only grants permission from a real click.
  */
  let permissionNeeded = $state(null);
  if (incoming) {
    go("studio");
    Promise.resolve(incoming)
      .then((result) => {
        if (!result) return;
        if (result.file) picked = result.file;
        else if (result.needsPermission) permissionNeeded = result;
      })
      .catch(() => {});
  }

  async function grantPermission() {
    const request = permissionNeeded;
    permissionNeeded = null;
    const result = await request.retry();
    if (result?.file) picked = result.file;
  }

  /*
    Offline readiness has to be true, not merely likely, because the home
    page states it as a fact. Both halves are required: a service worker
    controlling this page (on a first visit it installs but does not control
    the page that installed it, so the shell is not cached yet) and at least
    one super-resolution model on the device.
  */
  let offlineReady = $state(false);
  $effect(() => {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker.controller) return;
    cachedModels()
      .then((c) => (offlineReady = Boolean(c.sr_fast || c.sr_fast_dn50 || c.sr_fast_wdn || c.sr_quality)))
      .catch(() => {});
  });

  // Drop a photo anywhere. On a desktop this is how people expect to start,
  // and the alternative is a drop zone that is only live on one screen.
  let dragging = $state(0);
  function onDrop(event) {
    event.preventDefault();
    dragging = 0;
    const file = [...(event.dataTransfer?.files ?? [])].find((f) => f.type.startsWith("image/"));
    if (file) pick(file);
  }
</script>

<svelte:window
  ondragover={(e) => e.preventDefault()}
  ondrop={onDrop}
  ondragenter={() => (dragging += 1)}
  ondragleave={() => (dragging = Math.max(0, dragging - 1))}
/>

<header class="topbar">
  <button class="brand" onclick={() => go("home")}>
    <!--
      The mark, not just the wordmark. The marketing site's header carries
      both and the app's carried only the words, so the two did not look like
      the same product. Same file the tab icon uses.
    -->
    <img class="brandmark" src="./icons/favicon.svg" alt="" width="20" height="20" />
    <!--
      The wordmark is ONE flex item, not two. Left as `<span>Open</span>Pixels`
      the bare text becomes an anonymous flex item of its own, and the button's
      `gap` -- which exists to separate the mark from the words -- lands
      between "Open" and "Pixels" as well. It rendered as "Open Pixels".
    -->
    <span class="wordmark"><span class="op">Open</span>Pixels</span>
  </button>

  {#if route !== "home"}
    <button class="linkish" onclick={() => go("home")} aria-label={$t("nav.back")}>
      <Icon name="left" size={18} />
    </button>
  {/if}

  <button
    class="linkish account"
    class:on={route === "account"}
    onclick={() => go("account")}
    aria-label={$t("nav.account")}
    title={$t("nav.account")}
  >
    <Icon name="user" size={18} />
  </button>

  <label class="lang">
    <Icon name="globe" size={15} />
    <span class="sr-only">Language</span>
    <select bind:value={$lang}>
      {#each LANGUAGES as l (l.value)}
        <option value={l.value}>{l.label}</option>
      {/each}
    </select>
  </label>
</header>

<main class="shell">
  {#if permissionNeeded}
    <div class="permission card">
      <h2>{$t("permission.title")}</h2>
      <p class="lead">{$t("permission.body", { origin: permissionNeeded.origin })}</p>
      <button class="grant" onclick={grantPermission}>{$t("permission.allow")}</button>
      <p class="tiny muted">{$t("permission.why")}</p>
    </div>
  {:else if route === "studio"}
    <Studio file={picked} {go} {pick} />
  {:else if route === "batch"}
    <Batch {go} />
  {:else if route === "models"}
    <Models {go} {offlineReady} {modelSource} />
  {:else if route === "about"}
    <About {go} />
  {:else if route === "account"}
    <Account {go} />
  {:else}
    <Home {go} {pick} {offlineReady} />
  {/if}
</main>

{#if dragging > 0}
  <div class="dropzone"><span><Icon name="image" size={22} /> {$t("home.drop")}</span></div>
{/if}

<style>
  .linkish {
    background: none;
    border: 0;
    color: var(--text-muted);
    cursor: pointer;
    padding: var(--space-1);
    display: inline-flex;
  }
  /*
    The account control lives here and only here. It used to be a text link
    in the footer of two screens, which is where a reader looks last and
    where nobody looks for an account. Top right is where every application
    on the web puts it, and being in the sticky header means it is reachable
    from every screen rather than the two that happened to list it.
  */
  .brandmark {
    width: 20px;
    height: 20px;
    border-radius: 5px;
    display: block;
  }
  .account {
    border-radius: var(--radius-full, 999px);
  }
  .account:hover {
    color: var(--text-strong);
  }
  .account.on {
    color: var(--text-strong);
    background: var(--surface-sunken, rgba(0, 0, 0, 0.05));
  }
  .lang {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--text-muted);
  }
  .lang select {
    background: none;
    border: 0;
    color: inherit;
    font-size: 0.85rem;
    cursor: pointer;
    padding: 4px 2px;
  }
  .dropzone {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: grid;
    place-items: center;
    background: color-mix(in srgb, var(--bg-page) 82%, transparent);
    backdrop-filter: blur(4px);
    pointer-events: none;
  }
  .permission {
    display: grid;
    gap: var(--space-4);
    justify-items: start;
    margin-top: var(--space-6);
  }
  .permission h2 {
    margin: 0;
    font-size: 1.15rem;
    color: var(--text-strong);
  }
  .permission .lead {
    margin: 0;
  }
  .grant {
    min-height: 44px;
    padding: 0 var(--space-5);
    border: 0;
    border-radius: var(--radius-md);
    background: var(--gray-950);
    color: var(--gray-0);
    font: inherit;
    font-weight: var(--weight-medium);
    cursor: pointer;
  }
  .dropzone span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5) var(--space-6);
    border: 2px dashed var(--border-strong);
    border-radius: var(--radius-xl);
    background: var(--surface-card);
    color: var(--text-strong);
    font-size: 1rem;
  }
</style>
