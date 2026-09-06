# Decisions, and what they cost

The market research behind this project is a survey of twelve competitors.
Most of its conclusions were adopted; three were not, and one feature was
built that it explicitly recommended against. Those are the entries worth
reading.

## Adopted, with the reasoning intact

**Quality metrics are the differentiator.** The survey found that not one of
twelve products shows any measure of what changed. That is the whole reason
the compare slider is the first thing on the result screen rather than an
option in a menu.

**No credits, no tiers, no account.** The most common complaint across the
category was opaque pricing — "predatory coin system", subscriptions that
keep charging, refunds that do not arrive. The strongest available answer
was not better pricing but none, and a page that explains why in terms a
reader can check.

**Mobile browser first.** The survey found nobody treating it as the primary
target, and that the photos this product exists for are already on a phone.
Every layout here is one column; the widest breakpoint is a reading width.

## Departed from

**"Do not build a browser extension."** The survey's §八 ④ concluded the
form was unfilled for a reason: upload, progress, comparison and download do
not fit a popup. That reasoning is correct *about popups*, and this
extension does not put the work in one — the popup is a door, and the work
happens in a full tab. What the extension adds is the one thing a website
cannot: starting from an image already on a page. The brief asked for it,
and the objection turned out to be answerable rather than fundamental.

**8× and batch should be the paid tier.** The survey placed both behind a
subscription, reasoning that they consume real GPU time. They do — the
user's. 8× is two passes of the same model, and batch is a queue; neither
costs the project anything, so neither is charged for.

**Colourisation was left undecided** pending model choice. DeOldify is MIT,
so it is in, free, with its size stated before it starts. It ships at full
precision — 255 MB — because the fp16 conversion's failure mode is a file
that looks complete and fails only at load; see `MODELS.md`. It is also the
one model run below its native resolution, at 256² rather than 512², since
only its chroma output is used.

## Built against the recommendation

**Background removal** was listed as an opportunity for later, outside the
MVP. It is 5 MB and the pipeline already had everything it needed. Skipping
it would have been discipline for its own sake.

## Not built

**AI portrait generation.** The survey called it a "real opportunity with a
trap", and the trap is well documented: the leading product draws repeated,
specific complaints about changing users' race and skin tone. It also cannot
run on-device, so it would need a server, a price and an account — which
would undo the three things above. Making a photo clearer and generating a
new one are different jobs, and this does the first.

## Two engineering decisions worth recording

**Every tile is padded to one constant square.** Not for tidiness: WebGPU's
buffer planner rejects a shape it has not seen, with an error that names an
onnxruntime source file and points at the model's dynamic axes — which are
correct. See `docs/architecture.md`.

**Colourisation maps out-of-gamut colour by pulling chroma in, not by
clipping channels.** The sRGB gamut is a sliver near black, so a confident
warm cast on a shadow is unrepresentable, and clipping resolves it by
raising lightness. A black coat comes back brown and lifted, and the
photograph's own detail flattens. Giving up saturation instead keeps the
lightness that was actually recorded — and saturation is the half the model
was guessing at.
