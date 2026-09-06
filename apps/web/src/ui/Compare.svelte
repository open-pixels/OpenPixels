<script>
  /*
    The before/after slider.

    The research (§五 5.1) found this is a blank across all twelve
    competitors, so it is the first thing on the result screen rather than
    an option behind a menu.

    Two details that decide whether it feels right:

    - Both images are drawn at the *same* displayed size, with the "before"
      scaled up to the result's dimensions by the browser. Showing the
      original at its own smaller size would make the comparison meaningless
      — of course the bigger one looks better.
    - The handle is draggable by mouse, touch and arrow keys, and the whole
      strip is one control in the tab order, because on a phone this is the
      only interactive thing on screen.
  */
  import { t } from "$lib/i18n.js";

  let { before, after, alt = "" } = $props();

  let position = $state(50);
  let frame = $state(null);
  let dragging = $state(false);

  /*
    The overlaid "before" image is pinned to the frame's *pixel* width, not
    to 100% of its own clipped container, because that is what keeps the two
    images registered as the handle moves — a percentage would rescale the
    top image every time the clip changed and nothing would line up.

    Which means the width has to be re-measured whenever the frame changes
    size. Reading `clientWidth` during render only catches the first layout;
    rotating a phone, or resizing a window, would leave the "before" image at
    the old width — visibly offset from the "after" underneath it, at exactly
    the moment someone is trying to compare them.
  */
  let frameWidth = $state(0);

  $effect(() => {
    if (!frame) return;
    frameWidth = frame.clientWidth;
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => {
      frameWidth = entry.contentRect.width;
    });
    observer.observe(frame);
    return () => observer.disconnect();
  });

  function positionFrom(clientX) {
    if (!frame) return;
    const box = frame.getBoundingClientRect();
    if (box.width === 0) return;
    position = Math.min(100, Math.max(0, ((clientX - box.left) / box.width) * 100));
  }

  function down(event) {
    dragging = true;
    frame?.setPointerCapture?.(event.pointerId);
    positionFrom(event.clientX);
  }
  function move(event) {
    if (dragging) positionFrom(event.clientX);
  }
  function up(event) {
    dragging = false;
    frame?.releasePointerCapture?.(event.pointerId);
  }
  function key(event) {
    const step = event.shiftKey ? 10 : 2;
    if (event.key === "ArrowLeft") position = Math.max(0, position - step);
    else if (event.key === "ArrowRight") position = Math.min(100, position + step);
    else if (event.key === "Home") position = 0;
    else if (event.key === "End") position = 100;
    else return;
    event.preventDefault();
  }
</script>

<div
  class="frame"
  bind:this={frame}
  onpointerdown={down}
  onpointermove={move}
  onpointerup={up}
  onpointercancel={up}
  onkeydown={key}
  role="slider"
  tabindex="0"
  aria-label={$t("studio.drag")}
  aria-valuemin="0"
  aria-valuemax="100"
  aria-valuenow={Math.round(position)}
  aria-valuetext="{Math.round(position)}% {$t('studio.result')}"
>
  <img class="base" src={after} alt={alt || $t("studio.result")} draggable="false" />
  <div class="overlay" style="width:{position}%">
    <img
      class="top"
      src={before}
      alt={$t("studio.original")}
      draggable="false"
      style="width:{frameWidth}px"
    />
  </div>

  <div class="handle" style="left:{position}%">
    <span class="grip" aria-hidden="true"></span>
  </div>

  <span class="tag left" class:hidden={position < 14}>{$t("studio.original")}</span>
  <span class="tag right" class:hidden={position > 86}>{$t("studio.result")}</span>
</div>

<style>
  .frame {
    position: relative;
    overflow: hidden;
    border-radius: var(--radius-lg);
    background: var(--bg-sunken);
    touch-action: pan-y;
    cursor: ew-resize;
    user-select: none;
    line-height: 0;
  }
  .frame:focus-visible {
    outline: var(--border-width-strong) solid var(--focus-ring);
    outline-offset: 2px;
  }
  .base {
    display: block;
    width: 100%;
    height: auto;
  }
  .overlay {
    position: absolute;
    inset: 0 auto 0 0;
    overflow: hidden;
  }
  .top {
    display: block;
    height: 100%;
    object-fit: fill;
    max-width: none;
  }
  .handle {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--gray-0);
    box-shadow: 0 0 0 1px rgb(0 0 0 / 0.25);
    transform: translateX(-1px);
    pointer-events: none;
  }
  .grip {
    position: absolute;
    top: 50%;
    left: 50%;
    width: 40px;
    height: 40px;
    transform: translate(-50%, -50%);
    border-radius: var(--radius-full);
    background: var(--gray-0);
    box-shadow: var(--shadow-md);
  }
  .grip::before,
  .grip::after {
    content: "";
    position: absolute;
    top: 50%;
    width: 0;
    height: 0;
    border-block: 5px solid transparent;
    transform: translateY(-50%);
  }
  .grip::before {
    left: 9px;
    border-right: 6px solid var(--gray-700);
  }
  .grip::after {
    right: 9px;
    border-left: 6px solid var(--gray-700);
  }
  .tag {
    position: absolute;
    bottom: var(--space-3);
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: rgb(0 0 0 / 0.55);
    color: #fff;
    font-size: 0.75rem;
    line-height: 1.6;
    pointer-events: none;
    transition: opacity var(--duration-fast) var(--ease-standard);
  }
  .tag.left {
    left: var(--space-3);
  }
  .tag.right {
    right: var(--space-3);
  }
  .tag.hidden {
    opacity: 0;
  }
</style>
