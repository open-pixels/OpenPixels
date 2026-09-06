<script>
  /*
    Inline SVG rather than an icon package.

    A CDN-loaded icon set would disappear exactly when this app claims to
    still work — offline — and take the meaning of every button with it.
    These are Lucide paths, inlined; a dozen glyphs is not worth a runtime
    dependency that can fail.
  */
  let { name = "circle", size = 16, style = "" } = $props();

  const PATHS = {
    image: "M3 3h18v18H3z M8.5 10.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z M21 15l-5-5L5 21",
    camera:
      "M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z M12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    check: "M20 6 9 17l-5-5",
    x: "M18 6 6 18 M6 6l12 12",
    alert: "M12 9v4 M12 17h.01 M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
    info: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01",
    download: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3",
    left: "M15 18l-6-6 6-6",
    right: "M9 18l6-6-6-6",
    down: "M6 9l6 6 6-6",
    globe: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M2 12h20 M12 2a15.3 15.3 0 0 1 0 20a15.3 15.3 0 0 1 0-20z",
    shield: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
    wifiOff:
      "M2 2l20 20 M8.5 16.5a5 5 0 0 1 7 0 M5 12.9a10 10 0 0 1 5.2-2.7 M1.4 9.2a15 15 0 0 1 4.3-2.8 M18.4 12.9A10 10 0 0 0 15 10.7 M22.6 9.2A15 15 0 0 0 12 5 M12 20h.01",
    sparkles:
      "M12 3l1.9 4.6L18.5 9.5l-4.6 1.9L12 16l-1.9-4.6L5.5 9.5l4.6-1.9L12 3z M19 15l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9L19 15z",
    layers: "M12 2 2 7l10 5 10-5-10-5z M2 17l10 5 10-5 M2 12l10 5 10-5",
    files: "M15 2H8a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h9a2 2 0 0 0 2-2V6l-4-4z M15 2v4h4 M3 8v12a2 2 0 0 0 2 2h10",
    trash: "M3 6h18 M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2 M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6",
    loader: "M12 2v4 M12 18v4 M4.9 4.9l2.9 2.9 M16.2 16.2l2.9 2.9 M2 12h4 M18 12h4 M4.9 19.1l2.9-2.9 M16.2 7.8l2.9-2.9",
    gauge: "M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 12l4-4",
    scissors:
      "M6 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M6 21a3 3 0 1 0 0-6 3 3 0 0 0 0 6z M20 4 8.1 15.9 M8.1 8.1 20 20",
    palette:
      "M12 22a10 10 0 1 1 0-20c5 0 9 3.6 9 8 0 2.5-2 4-4 4h-2a2 2 0 0 0-1.6 3.2A2 2 0 0 1 12 22z M7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M12 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2z M16.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2z",
    user: "M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
    share: "M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8 M16 6l-4-4-4 4 M12 2v13",
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill="none"
  stroke="currentColor"
  stroke-width="1.7"
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
  {style}
>
  {#each (PATHS[name] ?? PATHS.info).split(" M") as d, i (i)}
    <path d={i === 0 ? d : `M${d}`} />
  {/each}
</svg>
