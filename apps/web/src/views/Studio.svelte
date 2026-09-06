<script>
  /*
    The single-photo flow: pick, adjust, run, compare, save.

    The screen is one column on every width. This is a phone-first product
    and the research is explicit that the audience arrives on one; a
    two-pane desktop layout would be a second thing to design, test and keep
    working for the smaller half of the traffic.
  */
  import { untrack } from "svelte";
  import { t } from "$lib/i18n.js";
  import { process as runJob, cached as cachedModels } from "$lib/engine/client.js";
  import { decode, toRgb, toUrl, toBlob, comparisonSheet, looksMonochrome } from "$lib/image.js";
  import { save, outputName } from "$lib/download.js";
  import { progressText, progressFraction, suffix, extensionFor } from "$lib/options.js";
  import { savedOptions } from "$lib/settings.js";
  import Button from "$ui/Button.svelte";
  import Icon from "$ui/Icon.svelte";
  import Compare from "$ui/Compare.svelte";
  import Quality from "$ui/Quality.svelte";
  import Options from "./Options.svelte";

  let { file, go, pick } = $props();

  let opts = $state({ ...$savedOptions });
  let cached = $state({});
  let source = $state(null); // { width, height, data }
  let sourceUrl = $state("");
  let resultUrl = $state("");
  let result = $state(null);
  let metrics = $state(null);
  let monochrome = $state(null);
  let capped = $state(null);
  let running = $state(false);
  let job = null;
  let progress = $state(null);
  let error = $state("");
  let fileInput;

  // Persist whatever the user last chose, so a second photo starts from it.
  $effect(() => savedOptions.set({ ...opts }));

  cachedModels()
    .then((r) => (cached = r.cached))
    .catch(() => {});

  /*
    Decode whenever a new file arrives.

    The body reads exactly one reactive value — `file` — and writes several.
    That asymmetry is the whole point: an effect that reads state it also
    writes re-runs on its own writes, and here that meant decoding the same
    photo forever, each pass minting object URLs that nothing revoked. So
    the old URLs are released in the *cleanup*, which Svelte runs untracked,
    and nothing in the body reads `sourceUrl` or `resultUrl`.
  */
  $effect(() => {
    const f = file;
    if (!f) return;

    let stale = false;
    let ownUrl = "";

    decode(f)
      .then(async (decoded) => {
        if (stale) return;
        const img = toRgb(decoded);
        ownUrl = await toUrl(img);
        if (stale) {
          URL.revokeObjectURL(ownUrl);
          return;
        }
        source = img;
        sourceUrl = ownUrl;
        monochrome = looksMonochrome(decoded);
      })
      .catch(() => {
        if (!stale) error = $t("error.decode");
      });

    return () => {
      stale = true;
      if (ownUrl) URL.revokeObjectURL(ownUrl);
    };
  });

  /*
    Clearing the previous photo's results is a *consequence of the prop
    changing*, not of any state this component owns, so it happens here
    rather than inside the effect above — where reading `resultUrl` to
    revoke it would put the loop straight back.
  */
  let lastFile = null;
  $effect(() => {
    if (file === lastFile) return;
    lastFile = file;
    untrack(() => {
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      resultUrl = "";
      source = null;
      result = null;
      metrics = null;
      capped = null;
      error = "";
      progress = null;
    });
  });

  async function run() {
    if (!source || running) return;
    error = "";
    running = true;
    progress = null;

    try {
      // The worker caps the working size when the output would be too large
      // for a browser tab to hold, and reports what it used — the resample
      // belongs on its side of the wire, with the rest of the pixel work.
      job = runJob(source, { ...opts }, (p) => (progress = p));
      const out = await job;
      if (resultUrl) URL.revokeObjectURL(resultUrl);
      result = out;
      resultUrl = await toUrl(out.image, out.alpha);
      metrics = out.metrics;
      monochrome = out.monochrome;
      capped = out.capped;
      cachedModels()
        .then((r) => (cached = r.cached))
        .catch(() => {});
    } catch (e) {
      if (!e?.cancelled) {
        error = /memory|allocat/i.test(e?.message ?? "") ? $t("error.memory") : (e?.message ?? String(e));
      }
    } finally {
      running = false;
      progress = null;
      job = null;
    }
  }

  function stop() {
    job?.cancel();
  }

  async function download() {
    if (!result) return;
    // A cut-out has to be PNG whatever the format setting says: JPEG has no
    // alpha channel and would silently fill the transparency with black.
    const format = result.alpha ? "image/png" : opts.format;
    const blob = await toBlob(result.image, result.alpha, format, opts.quality);
    save(blob, outputName(file?.name, suffix(opts), extensionFor(format)));
  }

  async function shareSheet() {
    if (!result || !source) return;
    const blob = await comparisonSheet(source, result.image);
    save(blob, outputName(file?.name, "-before-after", "png"));
  }

  function choose(event) {
    const f = event.currentTarget.files?.[0];
    if (f) pick(f);
    event.currentTarget.value = "";
  }

  const fraction = $derived(progressFraction(progress));
  const stageText = $derived(progressText(progress));
</script>

<div class="stack-lg">
  {#if error}
    <div class="card error">
      <h3><Icon name="alert" size={16} /> {$t("error.title")}</h3>
      <p class="tiny">{error}</p>
      <Button size="sm" variant="secondary" onclick={run} disabled={!source}>{$t("error.retry")}</Button>
    </div>
  {/if}

  {#if result && sourceUrl && resultUrl}
    <Compare before={sourceUrl} after={resultUrl} />
    <div class="row">
      <Button icon="download" onclick={download}>{$t("studio.download")}</Button>
      <Button variant="secondary" icon="share" onclick={shareSheet}>{$t("studio.share")}</Button>
    </div>
    <Quality {metrics} />
  {:else if sourceUrl}
    <div class="preview">
      <img src={sourceUrl} alt={$t("studio.original")} />
    </div>
  {:else}
    <div class="preview placeholder"><Icon name="image" size={28} /></div>
  {/if}

  {#if capped}
    <p class="note tiny"><Icon name="info" size={14} /> {$t("capped", { w: capped.width, h: capped.height })}</p>
  {/if}

  <Options bind:opts {cached} {monochrome} disabled={running} />

  {#if running}
    <div class="card progress">
      <p>{stageText || $t("studio.working")}</p>
      <div class="bar" class:indeterminate={fraction == null}>
        <span style={fraction == null ? "" : `width:${Math.round(fraction * 100)}%`}></span>
      </div>
      <Button size="sm" variant="secondary" onclick={stop}>{$t("studio.cancel")}</Button>
    </div>
  {:else}
    <Button size="lg" full icon="sparkles" onclick={run} disabled={!source}>
      {result ? $t("studio.rerun") : $t("studio.run")}
    </Button>
  {/if}

  <nav class="footer">
    <button class="inline" onclick={() => fileInput.click()}>{$t("studio.another")}</button>
    <button class="inline" onclick={() => go("batch")}>{$t("nav.batch")}</button>
    <button class="inline" onclick={() => go("models")}>{$t("nav.models")}</button>
  </nav>
  <input bind:this={fileInput} type="file" accept="image/*" class="sr-only" onchange={choose} />
</div>

<style>
  .preview {
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--bg-sunken);
    line-height: 0;
  }
  .preview img {
    display: block;
    width: 100%;
    height: auto;
  }
  .preview.placeholder {
    display: grid;
    place-items: center;
    min-height: 200px;
    color: var(--text-faint);
  }
  .row {
    display: flex;
    gap: var(--space-3);
    flex-wrap: wrap;
  }
  .row :global(.btn) {
    flex: 1 1 auto;
  }
  .error {
    border-color: color-mix(in srgb, var(--red) 35%, transparent);
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
  .error h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0;
    font-size: 1rem;
    color: var(--danger-fg);
  }
  .progress {
    display: grid;
    gap: var(--space-3);
    justify-items: start;
  }
  .progress p {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-strong);
  }
  .bar {
    width: 100%;
    height: 6px;
    border-radius: var(--radius-full);
    background: var(--bg-sunken);
    overflow: hidden;
  }
  .bar span {
    display: block;
    height: 100%;
    background: var(--gray-950);
    border-radius: var(--radius-full);
    transition: width var(--duration-base) var(--ease-out);
  }
  .bar.indeterminate span {
    width: 40%;
    animation: op-slide 1.4s var(--ease-standard) infinite;
  }
  .note {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-muted);
    margin: 0;
  }
  @keyframes op-slide {
    0% {
      transform: translateX(-100%);
    }
    100% {
      transform: translateX(250%);
    }
  }
</style>
