<script>
  /* The settings panel, shared by the Studio and the Batch screen so the
     two cannot drift into offering different things. */
  import { t } from "$lib/i18n.js";
  import { formatBytes, pendingDownloads } from "$lib/options.js";
  import Choice from "$ui/Choice.svelte";
  import Range from "$ui/Range.svelte";
  import Toggle from "$ui/Toggle.svelte";
  import Icon from "$ui/Icon.svelte";

  /*
    `monochrome` is tri-state on purpose: `null` means "not looked at yet",
    which is different from "has colour". Defaulting it to false would make
    the Batch screen — which never inspects a photo — warn about every one.
  */
  let { opts = $bindable(), cached = {}, monochrome = null, disabled = false } = $props();

  let advanced = $state(false);
  const pending = $derived(pendingDownloads(opts, cached));

  const sizeOptions = $derived([
    { value: 1, label: $t("opt.size.same") },
    { value: 2, label: "2×" },
    { value: 4, label: "4×" },
    { value: 8, label: "8×" },
  ]);
  const kindOptions = $derived([
    { value: "photo", label: $t("opt.kind.photo") },
    { value: "quality", label: $t("opt.kind.quality") },
    { value: "anime", label: $t("opt.kind.anime") },
  ]);
  const denoiseOptions = $derived([
    { value: "off", label: $t("opt.denoise.off") },
    { value: "medium", label: $t("opt.denoise.medium") },
    { value: "strong", label: $t("opt.denoise.strong") },
  ]);
  const backgroundOptions = $derived([
    { value: "keep", label: $t("opt.background.keep") },
    { value: "remove", label: $t("opt.background.remove") },
    { value: "white", label: $t("opt.background.white") },
  ]);

</script>

<div class="options card" class:disabled>
  <Choice bind:value={opts.factor} options={sizeOptions} label={$t("opt.size")} help={$t("opt.size.help")} />
  <Choice bind:value={opts.kind} options={kindOptions} label={$t("opt.kind")} help={$t("opt.kind.help")} />
  <Choice
    bind:value={opts.denoise}
    options={denoiseOptions}
    label={$t("opt.denoise")}
    help={$t("opt.denoise.help")}
  />

  <div class="toggles">
    <Toggle bind:checked={opts.faces} label={$t("opt.faces")} help={$t("opt.faces.help")} />
    {#if opts.faces}
      <div class="indent">
        <Range
          bind:value={opts.strength}
          min={0.2}
          max={1}
          step={0.05}
          label={$t("opt.faces.strength")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </div>
    {/if}

    <Toggle bind:checked={opts.colorize} label={$t("opt.colorize")} help={$t("opt.colorize.help")} />
    {#if monochrome && !opts.colorize}
      <p class="hint"><Icon name="info" size={14} /> {$t("opt.colorize.hint")}</p>
    {/if}
    {#if opts.colorize && monochrome === false}
      <!-- Colourising a photo that already has colour throws the real colour
           away and substitutes a guess. The toggle stays available — someone
           may want that — but silently making a good photo worse is not a
           thing to leave unsaid. -->
      <p class="hint warn"><Icon name="alert" size={14} /> {$t("opt.colorize.hascolour")}</p>
    {/if}
    {#if opts.colorize}
      <div class="indent">
        <Range
          bind:value={opts.saturation}
          min={0}
          max={1.6}
          step={0.05}
          label={$t("opt.colorize.saturation")}
          format={(v) => `${Math.round(v * 100)}%`}
        />
      </div>
    {/if}
  </div>

  <button class="disclose" onclick={() => (advanced = !advanced)} aria-expanded={advanced}>
    <Icon name={advanced ? "down" : "right"} size={14} />
    {$t("opt.advanced")}
  </button>

  {#if advanced}
    <div class="stack">
      <Choice bind:value={opts.background} options={backgroundOptions} label={$t("opt.background")} />
      <Range
        bind:value={opts.sharpen}
        min={0}
        max={1.5}
        step={0.05}
        label={$t("opt.sharpen")}
        format={(v) => (v === 0 ? "—" : `${Math.round(v * 100)}%`)}
      />
    </div>
  {/if}

  {#if pending.bytes > 0}
    <p class="download tiny">
      <Icon name="download" size={14} />
      {$t("opt.willdownload", { size: formatBytes(pending.bytes) })}
    </p>
  {/if}
</div>

<style>
  .options {
    display: grid;
    gap: var(--space-5);
  }
  .options.disabled {
    opacity: 0.5;
    pointer-events: none;
  }
  .toggles {
    display: grid;
    gap: var(--space-2);
  }
  .indent {
    padding-left: 52px;
    padding-bottom: var(--space-2);
  }
  .hint {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: 0.82rem;
    color: var(--info-fg);
    background: var(--info-bg);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    margin: 0;
  }
  .hint.warn {
    color: var(--warning-fg);
    background: var(--warning-bg);
  }
  .disclose {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: 0;
    padding: var(--space-2) 0;
    color: var(--text-muted);
    font-size: 0.88rem;
    cursor: pointer;
    justify-self: start;
  }
  .disclose:hover {
    color: var(--text-strong);
  }
  .download {
    display: flex;
    gap: 6px;
    align-items: center;
    color: var(--text-muted);
    margin: 0;
  }
</style>
