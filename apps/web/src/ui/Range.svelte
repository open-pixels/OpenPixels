<script>
  let { value = $bindable(0), min = 0, max = 1, step = 0.05, label = "", format = (v) => v } = $props();
</script>

<label class="range">
  <span class="head">
    <span>{label}</span>
    <span class="mono">{format(value)}</span>
  </span>
  <input type="range" {min} {max} {step} bind:value />
</label>

<style>
  .range {
    display: block;
  }
  .head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    font-size: 0.92rem;
    font-weight: var(--weight-medium);
    color: var(--text-strong);
    margin-bottom: var(--space-2);
  }
  .mono {
    font: var(--type-mono);
    font-size: 0.85rem;
    color: var(--text-muted);
  }
  input {
    width: 100%;
    /* Flips with the theme; a near-black thumb on a near-black page is
       findable only by feel. */
    accent-color: var(--text-strong);
    /* A slider is a fiddly target on a phone; give the thumb room. */
    height: 32px;
  }
</style>
