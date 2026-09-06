<script>
  /*
    The pricing page, which is the point.

    The research found that the single most common complaint across this
    whole category is opaque pricing — "predatory coin system", "the company
    steals your money", subscriptions that keep charging. The strongest
    thing this product can say is a short, checkable explanation of why
    there is no price, including the part that is unflattering: we do not
    charge because it costs us nothing, not because we are generous.
  */
  import { t } from "$lib/i18n.js";
  import Icon from "$ui/Icon.svelte";

  let { go } = $props();
</script>

<div class="stack-lg">
  <div>
    <h1>{$t("about.title")}</h1>
    <p class="lead big">{$t("about.free")}</p>
  </div>

  <div class="card stack">
    <section>
      <h3><Icon name="info" size={16} /> {$t("about.how.title")}</h3>
      <p>{$t("about.how.body")}</p>
    </section>
    <section>
      <h3><Icon name="shield" size={16} /> {$t("about.privacy.title")}</h3>
      <p>{$t("about.privacy.body")}</p>
    </section>
    <section>
      <h3><Icon name="layers" size={16} /> {$t("about.open.title")}</h3>
      <p>{$t("about.open.body")}</p>
    </section>
    <section>
      <h3><Icon name="user" size={16} /> {$t("about.notdoing.title")}</h3>
      <p>{$t("about.notdoing.body")}</p>
    </section>
  </div>

  <nav class="footer">
    <button class="inline" onclick={() => go("home")}>{$t("nav.home")}</button>
    <button class="inline" onclick={() => go("models")}>{$t("nav.models")}</button>
  </nav>
</div>

<style>
  .big {
    font-size: 1.15rem;
    color: var(--text-strong);
  }
  section h3 {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: 0 0 var(--space-2);
    font-size: 1rem;
  }
  section p {
    margin: 0;
    font-size: 0.95rem;
    color: var(--text-body);
  }
  .stack {
    gap: var(--space-6);
  }
</style>
