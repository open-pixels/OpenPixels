<script>
  /*
    Batch: the same settings over as many photos as you like.
    
    Sequential rather than parallel, and that is deliberate. The models hold
    hundreds of megabytes; running two at once on a phone means both die.
    Sequential keeps peak memory flat no matter how long the list is, which
    is what makes "no limit" a claim we can actually keep.
  */
  import { t } from "$lib/i18n.js";
  import { process as runJob, cached as cachedModels } from "$lib/engine/client.js";
  import { decode, toRgb, toBlob } from "$lib/image.js";
  import { save, zipFiles, metricsCsv, outputName } from "$lib/download.js";
  import { progressText, suffix, extensionFor } from "$lib/options.js";
  import { savedOptions } from "$lib/settings.js";
  import Button from "$ui/Button.svelte";
  import Icon from "$ui/Icon.svelte";
  import Options from "./Options.svelte";

  let { go } = $props();

  let opts = $state({ ...$savedOptions });
  let cached = $state({});
  let items = $state([]);
  let running = $state(false);
  let stopped = false;
  let current = null;
  let stage = $state("");
  let fileInput;

  cachedModels()
    .then((r) => (cached = r.cached))
    .catch(() => {});

  function add(event) {
    const files = [...(event.currentTarget.files ?? [])];
    items = [
      ...items,
      ...files.map((file) => ({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        status: "waiting",
        metrics: null,
        blob: null,
        error: "",
      })),
    ];
    event.currentTarget.value = "";
  }

  function clear() {
    items = [];
  }

  async function start() {
    if (running || !items.length) return;
    running = true;
    stopped = false;

    for (const item of items) {
      if (stopped) break;
      if (item.status === "done") continue;
      item.status = "running";
      items = items;
      try {
        const decoded = await decode(item.file);
        const img = toRgb(decoded);
        // The worker applies the working-size cap; see pipeline.js.
        current = runJob(img, { ...opts }, (p) => (stage = `${item.name} · ${progressText(p)}`));
        const out = await current;
        const format = out.alpha ? "image/png" : opts.format;
        item.blob = await toBlob(out.image, out.alpha, format, opts.quality);
        item.outName = outputName(item.name, suffix(opts), extensionFor(format));
        item.metrics = out.metrics;
        item.status = "done";
      } catch (e) {
        if (e?.cancelled) {
          item.status = "waiting";
          break;
        }
        item.status = "failed";
        item.error = e?.message ?? String(e);
      } finally {
        current = null;
        items = items;
      }
    }

    running = false;
    stage = "";
    cachedModels()
      .then((r) => (cached = r.cached))
      .catch(() => {});
  }

  function stop() {
    stopped = true;
    current?.cancel();
  }

  async function downloadAll() {
    const done = items.filter((i) => i.status === "done" && i.blob);
    if (!done.length) return;
    // Duplicate names are possible (two folders, same filename); a ZIP with
    // two identical entries confuses every extractor, so disambiguate.
    const seen = new Map();
    const entries = done.map((i) => {
      const n = (seen.get(i.outName) ?? 0) + 1;
      seen.set(i.outName, n);
      const name = n === 1 ? i.outName : i.outName.replace(/(\.[^.]+)$/, `-${n}$1`);
      return { name, blob: i.blob };
    });
    save(await zipFiles(entries), "openpixels-batch.zip");
  }

  function downloadCsv() {
    const done = items.filter((i) => i.metrics);
    if (!done.length) return;
    save(metricsCsv(done), "openpixels-measurements.csv");
  }

  const doneCount = $derived(items.filter((i) => i.status === "done").length);
  const statusLabel = (s) => $t(`batch.status.${s}`);
</script>

<div class="stack-lg">
  <div>
    <h1>{$t("batch.title")}</h1>
    <p class="lead">{$t("batch.sub")}</p>
  </div>

  <Options bind:opts {cached} disabled={running} />

  <div class="row">
    <Button icon="files" variant="secondary" onclick={() => fileInput.click()} disabled={running}>
      {$t("batch.add")}
    </Button>
    {#if running}
      <Button onclick={stop}>{$t("batch.stop")}</Button>
    {:else}
      <Button icon="sparkles" onclick={start} disabled={!items.length}>{$t("batch.run")}</Button>
    {/if}
  </div>
  <input bind:this={fileInput} type="file" accept="image/*" multiple class="sr-only" onchange={add} />

  {#if running && stage}
    <p class="note tiny"><Icon name="loader" size={14} style="animation:op-spin 900ms linear infinite" /> {stage}</p>
  {/if}

  {#if items.length}
    <div class="card list">
      <p class="count tiny muted">{$t("batch.done", { done: doneCount, total: items.length })}</p>
      <ul>
        {#each items as item (item.id)}
          <li>
            <span class="name" title={item.name}>{item.name}</span>
            <span class="status" data-status={item.status}>
              {item.status === "failed" && item.error ? item.error : statusLabel(item.status)}
            </span>
          </li>
        {/each}
      </ul>
    </div>

    <div class="row">
      <Button icon="download" onclick={downloadAll} disabled={!doneCount}>{$t("batch.download")}</Button>
      <Button variant="secondary" icon="gauge" onclick={downloadCsv} disabled={!doneCount}>
        {$t("batch.csv")}
      </Button>
      <Button variant="ghost" icon="trash" onclick={clear} disabled={running}>{$t("batch.clear")}</Button>
    </div>
  {:else}
    <p class="muted">{$t("batch.empty")}</p>
  {/if}

  <nav class="footer">
    <button class="inline" onclick={() => go("home")}>{$t("nav.home")}</button>
    <button class="inline" onclick={() => go("models")}>{$t("nav.models")}</button>
  </nav>
</div>

<style>
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .list ul {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
  }
  .list li {
    display: flex;
    justify-content: space-between;
    gap: var(--space-3);
    align-items: center;
    padding: var(--space-3) 0;
    border-bottom: var(--border-width) solid var(--border-hairline);
    font-size: 0.9rem;
  }
  .list li:last-child {
    border-bottom: 0;
  }
  .name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-body);
  }
  .status {
    flex: none;
    font-size: 0.8rem;
    color: var(--text-muted);
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: var(--bg-sunken);
    max-width: 55%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .status[data-status="done"] {
    background: var(--success-bg);
    color: var(--success-fg);
  }
  .status[data-status="failed"] {
    background: var(--danger-bg);
    color: var(--danger-fg);
  }
  .status[data-status="running"] {
    background: var(--info-bg);
    color: var(--info-fg);
  }
  .count {
    margin: 0 0 var(--space-2);
  }
  .note {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-muted);
    margin: 0;
  }
</style>
