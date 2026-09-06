<script>
  /*
    What is on this device, and a way to remove it.

    This screen exists because the app asks people to download up to 300 MB
    of weights, and a tool that takes that much space without telling you
    where it went, or letting you take it back, has not earned the privacy
    claim it makes on the home page.
  */
  import { t } from "$lib/i18n.js";
  import { cached as askCached, forget, releaseModels } from "$lib/engine/client.js";
  import { MODELS } from "$lib/engine/models.js";
  import { formatBytes } from "$lib/options.js";
  import Button from "$ui/Button.svelte";
  import Icon from "$ui/Icon.svelte";

  /*
    `modelSource` is supplied by a host that fetches weights from somewhere
    the user could change — which is the extension, and only the extension.
    The website serves its models from its own origin, so there is nothing
    to configure and the row does not appear.

    Shape: `{ value, save(url) }`. Keeping it a prop rather than reaching for
    `chrome.storage` here is what lets this component stay unaware that an
    extension exists.
  */
  let { go, offlineReady = false, modelSource = null } = $props();

  let sourceDraft = $state(modelSource?.value ?? "");
  let sourceSaved = $state(false);
  let sourceError = $state("");

  async function saveSource() {
    sourceError = "";
    const value = sourceDraft.trim();
    if (value) {
      // A typo here means every model 404s with no clue why, so reject
      // anything that is not a usable absolute http(s) URL up front.
      try {
        const url = new URL(value);
        if (!/^https?:$/.test(url.protocol)) throw new Error("protocol");
      } catch {
        sourceError = $t("models.source.invalid");
        return;
      }
    }
    await modelSource.save(value);
    sourceSaved = true;
  }

  let cached = $state({});
  let busy = $state("");

  function refresh() {
    askCached()
      .then((r) => (cached = r.cached))
      .catch(() => {});
  }
  refresh();

  async function remove(id) {
    busy = id ?? "all";
    try {
      /*
        Drop the loaded sessions before deleting the files. A session built
        from a model holds that model in memory, so deleting only the cache
        entry frees the disk and leaves hundreds of megabytes resident —
        which makes "Delete" a promise the page does not keep. Releasing
        everything is right rather than heavy-handed: sessions are rebuilt
        lazily, and someone on this page is not mid-photo.
      */
      await releaseModels();
      const r = await forget(id);
      cached = r.cached;
    } finally {
      busy = "";
    }
  }

  const entries = Object.entries(MODELS);
  const onDevice = $derived(entries.filter(([id]) => cached[id]));
  const totalBytes = $derived(onDevice.reduce((sum, [, m]) => sum + m.bytes, 0));
</script>

<div class="stack-lg">
  <div>
    <h1>{$t("models.title")}</h1>
    <p class="lead">{$t("models.sub")}</p>
  </div>

  {#if offlineReady}
    <p class="ready"><Icon name="wifiOff" size={15} /> {$t("models.offline")}</p>
  {/if}

  <div class="card">
    <p class="tiny muted total">
      {$t("models.total", { n: onDevice.length, size: formatBytes(totalBytes) })}
    </p>
    <ul>
      {#each entries as [id, model] (id)}
        <li>
          <div class="about">
            <strong>{model.label}</strong>
            {#if model.note}<span class="tiny muted">{model.note}</span>{/if}
            <span class="tiny muted mono">{formatBytes(model.bytes)}</span>
          </div>
          <div class="state">
            {#if cached[id]}
              <span class="pill on"><Icon name="check" size={12} /> {$t("models.on")}</span>
              <Button size="sm" variant="ghost" loading={busy === id} onclick={() => remove(id)}>
                {$t("models.forget")}
              </Button>
            {:else}
              <span class="pill">{$t("models.off")}</span>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
  </div>

  {#if onDevice.length}
    <Button variant="danger" icon="trash" loading={busy === "all"} onclick={() => remove(null)}>
      {$t("models.forgetAll")}
    </Button>
  {/if}

  {#if modelSource}
    <div class="card source">
      <h3>{$t("models.source.title")}</h3>
      <p class="tiny muted">{$t("models.source.body")}</p>
      <input
        type="url"
        inputmode="url"
        spellcheck="false"
        autocapitalize="off"
        bind:value={sourceDraft}
        placeholder={modelSource.fallback}
        aria-label={$t("models.source.title")}
        oninput={() => {
          sourceSaved = false;
          sourceError = "";
        }}
      />
      {#if sourceError}
        <p class="tiny bad">{sourceError}</p>
      {:else if sourceSaved}
        <p class="tiny good">{$t("models.source.saved")}</p>
      {/if}
      <Button size="sm" variant="secondary" onclick={saveSource}>{$t("models.source.save")}</Button>
    </div>
  {/if}

  <nav class="footer">
    <button class="inline" onclick={() => go("home")}>{$t("nav.home")}</button>
    <button class="inline" onclick={() => go("about")}>{$t("nav.about")}</button>
  </nav>
</div>

<style>
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-4);
    align-items: center;
    padding: var(--space-3) 0;
    border-bottom: var(--border-width) solid var(--border-hairline);
  }
  li:last-child {
    border-bottom: 0;
  }
  .about {
    display: grid;
    gap: 2px;
    min-width: 0;
  }
  .about strong {
    font-size: 0.95rem;
    color: var(--text-strong);
    font-weight: var(--weight-medium);
  }
  .mono {
    font: var(--type-mono);
    font-size: 0.78rem;
  }
  .state {
    flex: none;
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 3px 9px;
    border-radius: var(--radius-full);
    background: var(--bg-sunken);
    color: var(--text-muted);
    font-size: 0.76rem;
    white-space: nowrap;
  }
  .pill.on {
    background: var(--success-bg);
    color: var(--success-fg);
  }
  .ready {
    display: flex;
    gap: var(--space-2);
    align-items: center;
    padding: var(--space-3) var(--space-4);
    border-radius: var(--radius-md);
    background: var(--success-bg);
    color: var(--success-fg);
    font-size: 0.9rem;
    margin: 0;
  }
  .total {
    margin: 0 0 var(--space-2);
  }
  .source {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
  .source h3 {
    margin: 0;
  }
  .source p {
    margin: 0;
  }
  .source input {
    width: 100%;
    min-height: 44px;
    padding: 0 var(--space-3);
    border: var(--border-width) solid var(--border-hairline);
    border-radius: var(--radius-md);
    background: var(--bg-page);
    color: var(--text-body);
    font: var(--type-mono);
    font-size: 0.82rem;
  }
  .source input:focus-visible {
    outline: var(--border-width-strong) solid var(--focus-ring);
    outline-offset: 1px;
  }
  .good {
    color: var(--success-fg);
  }
  .bad {
    color: var(--danger-fg);
  }
</style>
