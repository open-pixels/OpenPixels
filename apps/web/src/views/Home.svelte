<script>
  import { t } from "$lib/i18n.js";
  import { dismissInstall, dismissedInstall } from "$lib/settings.js";
  import Button from "$ui/Button.svelte";
  import Icon from "$ui/Icon.svelte";

  let { go, pick, offlineReady = false } = $props();

  let fileInput;
  let cameraInput;

  /*
    "Add to home screen".

    The research's second entry point is a phone user who will not install an
    app, so this is offered rather than pushed: it appears only once the
    browser says the app is installable — which means the service worker is
    running and the manifest is valid — and never again once dismissed.

    The event fires before this component mounts as often as after, so both
    paths are handled; `index.html` stashes it on `window` at load, and the
    build script is what puts that there.
  */
  let installable = $state(Boolean(globalThis.__installPrompt) && !dismissedInstall());

  $effect(() => {
    if (dismissedInstall()) return;
    const on = () => (installable = true);
    addEventListener("openpixels:installable", on);
    return () => removeEventListener("openpixels:installable", on);
  });

  async function install() {
    const prompt = globalThis.__installPrompt;
    installable = false;
    dismissInstall();
    if (!prompt) return;
    globalThis.__installPrompt = null;
    // A prompt can only be shown once; the browser rejects a second call.
    await prompt.prompt().catch(() => {});
  }

  function notNow() {
    installable = false;
    dismissInstall();
  }

  function choose(event) {
    const file = event.currentTarget.files?.[0];
    if (file) pick(file);
    // Reset, so picking the same file twice in a row still fires change.
    event.currentTarget.value = "";
  }
</script>

<div class="stack-lg" style="padding-top:var(--space-6)">
  <div class="hero">
    <h1>{$t("app.tagline")}</h1>
    <p class="lead">{$t("app.sub")}</p>
  </div>

  <div class="stack">
    <Button size="lg" full icon="image" onclick={() => fileInput.click()}>{$t("home.start")}</Button>
    <Button size="lg" full variant="secondary" icon="camera" onclick={() => cameraInput.click()}>
      {$t("home.camera")}
    </Button>
    <p class="tiny centre muted">{$t("home.drop")}</p>
  </div>

  <input bind:this={fileInput} type="file" accept="image/*" class="sr-only" onchange={choose} />
  <!-- `capture` asks a phone for the camera directly. Desktop browsers
       ignore it and show the normal picker, which is the right fallback. -->
  <input
    bind:this={cameraInput}
    type="file"
    accept="image/*"
    capture="environment"
    class="sr-only"
    onchange={choose}
  />

  <ul class="promises">
    <li>
      <Icon name="check" size={17} />
      <div>
        <strong>{$t("promise.free.title")}</strong>
        <p class="tiny">{$t("promise.free.body")}</p>
      </div>
    </li>
    <li>
      <Icon name="shield" size={17} />
      <div>
        <strong>{$t("promise.private.title")}</strong>
        <p class="tiny">{$t("promise.private.body")}</p>
      </div>
    </li>
    <li>
      <Icon name="gauge" size={17} />
      <div>
        <strong>{$t("promise.proof.title")}</strong>
        <p class="tiny">{$t("promise.proof.body")}</p>
      </div>
    </li>
    {#if offlineReady}
      <li>
        <Icon name="wifiOff" size={17} />
        <div>
          <strong><span class="tag">{$t("promise.offline.ready")}</span></strong>
          <p class="tiny">{$t("models.offline")}</p>
        </div>
      </li>
    {/if}
  </ul>

  {#if installable}
    <div class="install card">
      <div>
        <strong>{$t("install.title")}</strong>
        <p class="tiny">{$t("install.body")}</p>
      </div>
      <div class="install-actions">
        <Button size="sm" onclick={install}>{$t("install.add")}</Button>
        <Button size="sm" variant="ghost" onclick={notNow}>{$t("install.no")}</Button>
      </div>
    </div>
  {/if}

  <div class="card">
    <h3 style="margin-bottom:var(--space-3)">{$t("home.tips.title")}</h3>
    <ul class="tips">
      <li>{$t("home.tips.1")}</li>
      <li>{$t("home.tips.2")}</li>
      <li>{$t("home.tips.3")}</li>
      <li class="muted">{$t("home.tips.4")}</li>
    </ul>
  </div>

  <nav class="footer">
    <button class="inline" onclick={() => go("batch")}>{$t("nav.batch")}</button>
    <button class="inline" onclick={() => go("models")}>{$t("nav.models")}</button>
    <button class="inline" onclick={() => go("about")}>{$t("nav.about")}</button>
  </nav>
</div>

<style>
  .hero h1 {
    text-wrap: balance;
    margin-bottom: var(--space-3);
  }
  .promises {
    list-style: none;
    padding: 0;
    display: grid;
    gap: var(--space-4);
  }
  .promises li {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
  }
  .promises strong {
    display: block;
    font-size: 0.95rem;
    color: var(--text-strong);
  }
  .promises p {
    margin-top: 2px;
  }
  .tips {
    display: grid;
    gap: var(--space-2);
    padding-left: var(--space-5);
    margin: 0;
    font-size: 0.92rem;
  }
  .install {
    display: grid;
    gap: var(--space-3);
  }
  .install strong {
    display: block;
    font-size: 0.95rem;
    color: var(--text-strong);
  }
  .install p {
    margin-top: 2px;
  }
  .install-actions {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
  }
  .tag {
    display: inline-block;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--success-bg);
    color: var(--success-fg);
    font-size: 0.78rem;
  }
</style>
