<script>
  /* A segmented control. Large hit areas, wraps on a narrow screen, and
     reads as a radio group to a screen reader. */
  let { value = $bindable(), options = [], label = "", help = "", name = "" } = $props();
  // A stable fallback: the id only has to be unique on the page, and
  // regenerating it whenever the component re-renders would detach the
  // radios from each other mid-interaction.
  const fallback = `choice-${Math.random().toString(36).slice(2, 8)}`;
  const group = $derived(name || fallback);
</script>

<fieldset class="choice">
  {#if label}<legend>{label}</legend>{/if}
  <div class="options">
    {#each options as opt (opt.value)}
      <label class="opt" class:on={value === opt.value}>
        <input type="radio" name={group} value={opt.value} bind:group={value} />
        <span>{opt.label}</span>
      </label>
    {/each}
  </div>
  {#if help}<p class="tiny muted">{help}</p>{/if}
</fieldset>

<style>
  .choice {
    border: 0;
    padding: 0;
    margin: 0;
    min-width: 0;
  }
  legend {
    padding: 0;
    font-weight: var(--weight-medium);
    font-size: 0.92rem;
    color: var(--text-strong);
    margin-bottom: var(--space-2);
  }
  .options {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }
  .opt {
    display: inline-flex;
    align-items: center;
    min-height: 40px;
    padding: 0 var(--space-4);
    border: var(--border-width) solid var(--border-hairline);
    border-radius: var(--radius-md);
    background: var(--surface-card);
    color: var(--text-body);
    cursor: pointer;
    font-size: 0.92rem;
    transition: all var(--duration-fast) var(--ease-standard);
  }
  .opt:hover {
    border-color: var(--border-strong);
  }
  .opt.on {
    background: var(--surface-inverse);
    color: var(--text-inverse);
    border-color: var(--surface-inverse);
  }
  .opt input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .opt:focus-within {
    outline: var(--border-width-strong) solid var(--focus-ring);
    outline-offset: 2px;
  }
  .tiny {
    margin-top: var(--space-2);
  }
</style>
