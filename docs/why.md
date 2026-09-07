# Why this exists

## The problem

A photo you care about is too small, too soft, or too old. It is a
screenshot of a screenshot, a scan of a print, a frame pulled off a phone
from 2011. You want it sharp. This is one of the most-searched things
anybody asks software to do.

## What exists today

Twelve products were surveyed before any code was written. They are
competent and they converge on one shape: upload the photo to a server, get
back a watermarked or downscaled preview, and pay a subscription to keep the
result. The pricing is credits on top of a monthly fee, and the single most
common complaint across their reviews is not quality — it is that the
pricing is opaque, that the trial charges, and that cancelling is hard.

Two other things are true of all twelve, and they matter more:

**None of them shows you what changed.** You get an output. Whether it is
genuinely sharper, or merely different — whether the model invented a face
that is not the face in your photo — is left to your eye on a small preview.
Quality-metric display was a 12-out-of-12 blank.

**All of them see your photo.** That is not a policy failing; it is
structural. The model runs on their GPU, so the image has to arrive there.

## The structural gap

The upload is what everything else is downstream of. It creates a per-photo
GPU bill, and the bill creates the subscription, the credit balance, the
watermark, the account, and the queue. Remove the upload and the entire
commercial apparatus has nothing to charge for.

The models this needs — Real-ESRGAN, GFPGAN, U²-Net, DeOldify — are all
published under licences that permit commercial use, and all of them are
small enough to run on a phone. Nothing about the *technology* required the
server. What required the server was that browsers could not run this in
2021, and the products were built then.

They can now. That is the whole opportunity, and it has a shelf life.

## What a local Rust core buys that a hosted service cannot

Speed is not the argument — a datacentre GPU beats a phone. Four other
things are:

**The photo does not move.** Not a promise in a privacy policy; a property
of where the code runs. The content security policy names exactly three
origins it may talk to, so a dependency that started phoning home would fail
loudly in the browser rather than quietly succeeding.

**Free is not a loss-leader.** There is no per-photo cost to recover, so
every feature is free — including 8× and unlimited batch, which the research
put in the paid tier. That is not generosity, it is arithmetic, and it means
there will never be a pricing page to get worse.

**The measurements can be honest.** Sharpness, noise and fidelity are
computed from the actual pixels, in one Rust implementation that `cargo
test` exercises, and shown next to the result — including when the answer is
"this is not sharper". A hosted product has a commercial reason not to build
that. This one has a reason to: it is the only claim a competitor cannot
copy without giving up the upload.

**One implementation, two surfaces.** The web app and the extension are the
same source, and every pixel operation around the model — tiling, seam
merging, the metrics, the colour maths, face alignment — lives in the Rust
crate rather than in JavaScript. So there is exactly one place a seam bug
can be, and it is the place that has unit tests.

## What is deliberately absent

AI portrait generation — the "make me look better" feature that is the
industry's biggest earner. It cannot run on a phone, so it would need a
server, a price and an account, and it would undo every argument above. The
products that offer it also draw steady, specific complaints about altering
people's skin tone and features.

Enhancing your photo and inventing a new one are different jobs. This does
the first one.
