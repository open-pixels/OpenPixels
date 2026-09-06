<script>
  /*
    The quality panel — the feature none of the twelve competitors has.

    The research is explicit about how to present it (§五 5.2): the audience
    does not know what PSNR is, and a panel that leads with it teaches them
    nothing and makes the product feel like it is for someone else. So the
    top line is a sentence — "twice as sharp, noise down, faithful to the
    original" — and the numbers sit under a disclosure for the minority who
    want them.

    "Faithful" deserves its own explanation, and gets one, because it is the
    honest answer to the fear this category earns: that the model made
    something up. Shrinking the result back down and comparing it with the
    input is the check that catches exactly that.
  */
  import { t } from "$lib/i18n.js";
  import Icon from "./Icon.svelte";

  let { metrics } = $props();
  let open = $state(false);

  const sharpen = $derived(
    metrics && metrics.sharpness_before > 0.01 ? metrics.sharpness_after / metrics.sharpness_before : 1,
  );
  const sharperText = $derived(
    sharpen >= 1.15 ? $t("quality.sharper", { n: sharpen.toFixed(1) }) : $t("quality.sharper.none"),
  );
  const noiseDown = $derived(metrics ? metrics.noise_before - metrics.noise_after : 0);
  const noiseText = $derived(
    !metrics
      ? ""
      : metrics.noise_before < 0.6
        ? $t("quality.noise.clean")
        : $t("quality.noise", {
            before: metrics.noise_before.toFixed(1),
            after: metrics.noise_after.toFixed(1),
          }),
  );
  // SSIM above ~0.7 after a shrink-back means the structure survived. Below
  // that the model reorganised things, and the badge should not claim
  // otherwise.
  const faithful = $derived(metrics ? metrics.ssim >= 0.7 : false);
  const num = (v, digits = 2) => (v == null ? "—" : v.toFixed(digits));
</script>

{#if metrics}
  <div class="quality">
    <h3><Icon name="gauge" size={16} /> {$t("quality.title")}</h3>

    <ul class="lines">
      <li class="strong">{sharperText}</li>
      {#if noiseDown > 0.3 || metrics.noise_before < 0.6}
        <li>{noiseText}</li>
      {/if}
      <li class="muted">
        {$t("quality.size", {
          w: metrics.output_width,
          h: metrics.output_height,
          ow: metrics.input_width,
          oh: metrics.input_height,
        })}
      </li>
      {#if faithful}
        <li class="faithful">
          <Icon name="check" size={14} />
          <span>
            {$t("quality.faithful")}
            <span class="tiny muted">{$t("quality.faithful.help")}</span>
          </span>
        </li>
      {/if}
    </ul>

    <button class="disclose" onclick={() => (open = !open)} aria-expanded={open}>
      <Icon name={open ? "down" : "right"} size={14} />
      {$t("quality.numbers")}
    </button>

    {#if open}
      <table>
        <thead>
          <tr>
            <th></th>
            <th>{$t("quality.before")}</th>
            <th>{$t("quality.after")}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <th>{$t("quality.sharpness")}</th>
            <td>{num(metrics.sharpness_before)}</td>
            <td>{num(metrics.sharpness_after)}</td>
          </tr>
          <tr>
            <th>{$t("quality.noiselevel")}</th>
            <td>{num(metrics.noise_before, 3)}</td>
            <td>{num(metrics.noise_after, 3)}</td>
          </tr>
          <tr>
            <th>{$t("quality.psnr")}</th>
            <td colspan="2">{metrics.psnr == null ? "—" : `${num(metrics.psnr)} dB`}</td>
          </tr>
          <tr>
            <th>{$t("quality.ssim")}</th>
            <td colspan="2">{num(metrics.ssim, 4)}</td>
          </tr>
        </tbody>
      </table>
      <p class="tiny muted">{$t("quality.explain")}</p>
    {/if}
  </div>
{/if}

<style>
  .quality {
    background: var(--surface-card);
    border: var(--border-width) solid var(--border-hairline);
    border-radius: var(--radius-lg);
    padding: var(--space-5);
  }
  h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-3);
    font-size: 1rem;
  }
  .lines {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    gap: var(--space-2);
  }
  .lines .strong {
    font-size: 1.35rem;
    font-weight: var(--weight-medium);
    color: var(--text-strong);
    letter-spacing: var(--tracking-heading);
  }
  .faithful {
    display: flex;
    gap: var(--space-2);
    align-items: flex-start;
    color: var(--success-fg);
    margin-top: var(--space-1);
  }
  .faithful span {
    display: grid;
    gap: 2px;
  }
  .disclose {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    margin-top: var(--space-4);
    padding: var(--space-2) 0;
    background: none;
    border: 0;
    color: var(--text-muted);
    font-size: 0.88rem;
    cursor: pointer;
  }
  .disclose:hover {
    color: var(--text-strong);
  }
  table {
    width: 100%;
    border-collapse: collapse;
    margin-top: var(--space-2);
    font-size: 0.88rem;
  }
  th,
  td {
    text-align: right;
    padding: var(--space-2) 0;
    border-bottom: var(--border-width) solid var(--border-hairline);
  }
  thead th {
    color: var(--text-muted);
    font-weight: var(--weight-regular);
    font-size: 0.8rem;
  }
  tbody th {
    text-align: left;
    font-weight: var(--weight-regular);
    color: var(--text-muted);
  }
  td {
    font: var(--type-mono);
    font-size: 0.85rem;
    color: var(--text-strong);
  }
  p.tiny {
    margin-top: var(--space-3);
  }
</style>
