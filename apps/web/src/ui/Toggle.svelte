<script>
  let { checked = $bindable(false), label = "", help = "", disabled = false } = $props();
</script>

<label class="toggle" class:off={disabled}>
  <input type="checkbox" bind:checked {disabled} />
  <span class="box" aria-hidden="true"></span>
  <span class="text">
    <span class="label">{label}</span>
    {#if help}<span class="tiny muted">{help}</span>{/if}
  </span>
</label>

<style>
  .toggle {
    display: flex;
    gap: var(--space-3);
    align-items: flex-start;
    cursor: pointer;
    min-height: 44px;
    padding: var(--space-1) 0;
  }
  .toggle.off {
    opacity: 0.55;
    cursor: default;
  }
  input {
    position: absolute;
    opacity: 0;
    width: 0;
    height: 0;
  }
  .box {
    flex: none;
    width: 40px;
    height: 24px;
    margin-top: 2px;
    border-radius: var(--radius-full);
    background: var(--gray-300);
    position: relative;
    transition: background var(--duration-fast) var(--ease-standard);
  }
  .box::after {
    content: "";
    position: absolute;
    top: 3px;
    left: 3px;
    width: 18px;
    height: 18px;
    border-radius: var(--radius-full);
    background: var(--gray-0);
    transition: transform var(--duration-fast) var(--ease-standard);
  }
  input:checked + .box {
    background: var(--gray-950);
  }
  input:checked + .box::after {
    transform: translateX(16px);
  }
  input:focus-visible + .box {
    outline: var(--border-width-strong) solid var(--focus-ring);
    outline-offset: 2px;
  }
  .text {
    display: grid;
    gap: 2px;
  }
  .label {
    font-weight: var(--weight-medium);
    font-size: 0.95rem;
    color: var(--text-strong);
  }
</style>
