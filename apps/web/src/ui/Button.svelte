<script>
  import Icon from "./Icon.svelte";

  let {
    variant = "primary", // primary | secondary | ghost | danger
    size = "md", // sm | md | lg
    icon = "",
    loading = false,
    disabled = false,
    full = false,
    type = "button",
    onclick = undefined,
    children,
    ...rest
  } = $props();

  const off = $derived(disabled || loading);
  const iconSize = $derived(size === "sm" ? 14 : size === "lg" ? 19 : 16);
</script>

<button {type} class="btn" class:full data-variant={variant} data-size={size} disabled={off} {onclick} {...rest}>
  {#if loading}
    <Icon name="loader" size={iconSize} style="animation:op-spin 900ms linear infinite" />
  {:else if icon}
    <Icon name={icon} size={iconSize} />
  {/if}
  {@render children?.()}
</button>

<style>
  .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 0.5em;
    border: var(--border-width) solid transparent;
    border-radius: var(--radius-md);
    font-weight: var(--weight-medium);
    cursor: pointer;
    transition:
      background var(--duration-fast) var(--ease-standard),
      color var(--duration-fast) var(--ease-standard),
      border-color var(--duration-fast) var(--ease-standard);
    /* Never below the platform minimum touch target: this is used
       one-handed, on a phone, by someone who is not enjoying the task. */
    min-height: 44px;
  }
  .btn.full {
    width: 100%;
  }
  .btn:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .btn[data-size="sm"] {
    min-height: 34px;
    padding: 0 var(--space-3);
    font-size: 0.86rem;
  }
  .btn[data-size="md"] {
    padding: 0 var(--space-4);
    font-size: 0.95rem;
  }
  .btn[data-size="lg"] {
    min-height: 54px;
    padding: 0 var(--space-6);
    font-size: 1.05rem;
  }
  /* The inverse *pair*, not two raw greys. `--gray-950` on `--gray-0` is
     the right ink in the light theme and a near-black block on a near-black
     page in the dark one: the primary action loses every bit of its
     emphasis and reads as disabled. The semantic tokens flip — near-black
     holding white, then white holding near-black — so the button stays the
     most prominent thing on the screen either way. */
  .btn[data-variant="primary"] {
    background: var(--surface-inverse);
    color: var(--text-inverse);
  }
  .btn[data-variant="primary"]:hover:not(:disabled) {
    background: color-mix(in srgb, var(--surface-inverse) 86%, var(--bg-page));
  }
  .btn[data-variant="secondary"] {
    background: var(--surface-card);
    color: var(--text-strong);
    border-color: var(--border-strong);
  }
  .btn[data-variant="secondary"]:hover:not(:disabled) {
    background: var(--bg-sunken);
  }
  .btn[data-variant="ghost"] {
    background: transparent;
    color: var(--text-muted);
  }
  .btn[data-variant="ghost"]:hover:not(:disabled) {
    color: var(--text-strong);
    background: var(--bg-sunken);
  }
  .btn[data-variant="danger"] {
    background: transparent;
    color: var(--red);
    border-color: color-mix(in srgb, var(--red) 40%, transparent);
  }
</style>
