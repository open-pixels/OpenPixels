//! Run the real pipeline over a real photograph and print what it made of it.
//!
//!     cargo run --release -p pixels-core --example inspect -- photo.jpg
//!     cargo run --release -p pixels-core --example inspect -- photo.jpg --tile 256 --scale 2
//!
//! The unit tests are built from images this file could not produce: flat
//! fields, planted gradients, an identity "model". They pass on arithmetic
//! that a photograph breaks — a sky is a gradient over thousands of pixels,
//! and a seam in it is visible at a quarter of a count, which no synthetic
//! fixture in the suite is large enough to expose.
//!
//! So this walks the same code the browser drives: `tile::plan`, then
//! `tile::extract` per tile, then `tile::Merger`, then `metrics::report`.
//! The one thing it cannot run is the ONNX graph itself, which needs
//! onnxruntime and a browser; in its place each tile is upscaled with
//! Lanczos3. That stands in for the model exactly where it matters here —
//! it is a real, content-dependent function of the tile's own pixels, so
//! neighbouring tiles disagree slightly in the overlap, which is the
//! condition a seam needs to appear.
//!
//! Read the output adversarially. Every line is there because it can be
//! wrong: tiles that do not cover the image, a pad square that varies with
//! the photo, a merge that leaves a ridge, metrics that claim a plain
//! upscale sharpened something.

use pixels_core::{color, face, filters, matte, metrics, resize, tile, Rgb};
use std::time::Instant;

fn arg(name: &str, default: u32) -> u32 {
    let mut it = std::env::args();
    while let Some(a) = it.next() {
        if a == name {
            return it.next().and_then(|v| v.parse().ok()).unwrap_or(default);
        }
    }
    default
}

fn main() {
    let path = match std::env::args().nth(1) {
        Some(p) if !p.starts_with("--") => p,
        _ => {
            eprintln!("usage: inspect <image> [--tile N] [--overlap N] [--scale N]");
            eprintln!("point it at a real photograph, not a fixture");
            std::process::exit(2);
        }
    };

    // The app's own settings: apps/web/src/lib/engine/pipeline.js picks 192
    // on the CPU path and 256 with WebGPU, and OVERLAP is 16 everywhere.
    let tile_size = arg("--tile", 192);
    let overlap = arg("--overlap", 16);
    let scale = arg("--scale", 4);

    let bytes = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let decoded = image::open(&path)
        .unwrap_or_else(|e| {
            eprintln!("inspect: cannot decode {path}: {e}");
            std::process::exit(1);
        })
        .to_rgb8();
    let img = Rgb::from_vec(decoded.width(), decoded.height(), decoded.into_raw());
    let mp = img.width as f64 * img.height as f64 / 1e6;

    println!("\n{path}");
    println!(
        "  {} x {} = {:.2} MP, {:.1} KB on disk ({:.1} bits/pixel)",
        img.width,
        img.height,
        mp,
        bytes as f64 / 1024.0,
        bytes as f64 * 8.0 / (mp * 1e6)
    );

    // ---- the plan -------------------------------------------------------
    let plan = tile::plan(img.width, img.height, tile_size, overlap);
    let pads: Vec<u32> = plan.tiles.iter().map(|t| t.w.max(t.h)).collect();
    println!(
        "\ntiles   {} at {}px core, {}px overlap, every one padded to {}x{}",
        plan.tiles.len(),
        plan.tile,
        plan.overlap,
        plan.pad,
        plan.pad
    );
    println!(
        "        largest expanded tile {}px — {} the pad square",
        pads.iter().copied().max().unwrap_or(0),
        if pads.iter().all(|&p| p <= plan.pad) { "within" } else { "OVER" }
    );

    // Coverage: every pixel must be claimed by at least one tile, and no
    // more than four (a corner) can meet at a point, which is the bound the
    // merger's u16 weight sums are sized for.
    let mut depth = vec![0u8; (img.width * img.height) as usize];
    for t in &plan.tiles {
        for y in t.y..t.y + t.h {
            for x in t.x..t.x + t.w {
                depth[(y * img.width + x) as usize] += 1;
            }
        }
    }
    let uncovered = depth.iter().filter(|&&d| d == 0).count();
    let deepest = depth.iter().copied().max().unwrap_or(0);
    println!(
        "        coverage {} uncovered, deepest overlap {} tiles",
        uncovered, deepest
    );

    // ---- the merge ------------------------------------------------------
    let t0 = Instant::now();
    let mut merger = tile::Merger::new(img.width * scale, img.height * scale);
    for t in &plan.tiles {
        let chw = tile::extract(&img, t, plan.pad);
        let side = plan.pad.max(t.w).max(t.h);
        let out_side = side * scale;
        let plane = (side * side) as usize;
        let mut up = vec![0.0f32; (out_side * out_side) as usize * 3];
        for c in 0..3 {
            let src = &chw[c * plane..(c + 1) * plane];
            let big = resize::resize_plane(src, side, side, out_side, out_side);
            up[c * big.len()..(c + 1) * big.len()].copy_from_slice(&big);
        }
        merger.add(&plan, t, scale, &up);
    }
    let merged = merger.finish();
    let merge_ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!(
        "\nmerge   {} x {} in {:.0} ms — {:.2} MP/s of output",
        merged.width,
        merged.height,
        merge_ms,
        (merged.width as f64 * merged.height as f64 / 1e6) / (merge_ms / 1000.0)
    );

    // ---- the seam -------------------------------------------------------
    // The same upscale done in one piece. The tiled result cannot equal it
    // — the model sees a different neighbourhood at a tile edge — but the
    // difference must be smooth and small. A seam shows up as a large
    // difference concentrated on one column or row.
    let whole = resize::resize(&img, merged.width, merged.height, resize::Filter::Lanczos3);
    let (mut worst, mut sum) = (0i32, 0f64);
    let mut worst_at = (0u32, 0u32);
    let mut col_err = vec![0f64; merged.width as usize];
    let mut row_err = vec![0f64; merged.height as usize];
    for y in 0..merged.height {
        for x in 0..merged.width {
            let i = ((y * merged.width + x) * 3) as usize;
            let d = (0..3)
                .map(|c| (merged.data[i + c] as i32 - whole.data[i + c] as i32).abs())
                .max()
                .unwrap_or(0);
            if d > worst {
                worst = d;
                worst_at = (x, y);
            }
            sum += d as f64;
            col_err[x as usize] += d as f64;
            row_err[y as usize] += d as f64;
        }
    }
    let n = merged.width as f64 * merged.height as f64;
    let overall = sum / n;
    println!(
        "\nseam    mean |tiled - whole| {:.3} counts over {:.1} MP",
        overall,
        n / 1e6
    );

    // A seam is a *column* whose mean error stands above its neighbours, and
    // it can only be at a tile boundary. The image border is not one: there
    // `extract` replicates the edge to fill the pad square while the
    // whole-image resize uses its own clamping, so the two differ by a
    // couple of counts for reasons that have nothing to do with merging.
    // The first cut of this check reported that border difference as the
    // "sharpest ridge" and would have been read as a seam.
    let edge = (plan.overlap * scale) as usize;
    let ridge = |mean: &[f64], skip: usize| -> (f64, usize) {
        let (mut best, mut at) = (0.0f64, 0usize);
        for i in skip.max(1)..mean.len().saturating_sub(skip.max(1)) {
            let local = (mean[i - 1] + mean[i + 1]) / 2.0;
            if mean[i] - local > best {
                best = mean[i] - local;
                at = i;
            }
        }
        (best, at)
    };
    let col_mean: Vec<f64> = col_err.iter().map(|e| e / merged.height as f64).collect();
    let row_mean: Vec<f64> = row_err.iter().map(|e| e / merged.width as f64).collect();
    let (cx, cxi) = ridge(&col_mean, edge);
    let (ry, ryi) = ridge(&row_mean, edge);
    println!(
        "        interior ridge: {:.3} counts at column {}, {:.3} at row {} — a visible seam is ~1",
        cx, cxi, ry, ryi
    );

    // And name the columns where a seam would have to be, so the number
    // above is checkable rather than merely small.
    let mut boundaries: Vec<usize> = Vec::new();
    let mut x = plan.tile;
    while x < plan.width {
        boundaries.push((x * scale) as usize);
        x += plan.tile;
    }
    if let Some(&b) = boundaries.first() {
        let at: Vec<String> = boundaries
            .iter()
            .take(4)
            .map(|&i| format!("{:.3}", col_mean.get(i).copied().unwrap_or(0.0)))
            .collect();
        println!(
            "        {} tile boundaries, first at x={}; error there {} vs {:.3} overall",
            boundaries.len(),
            b,
            at.join(", "),
            overall
        );
    }
    println!(
        "        border (excluded): worst single pixel {} at ({}, {})",
        worst, worst_at.0, worst_at.1
    );

    // ---- what the app would report --------------------------------------
    let t0 = Instant::now();
    let report = metrics::report(&img, &merged);
    let metrics_ms = t0.elapsed().as_secs_f64() * 1000.0;
    println!(
        "\nreport  SSIM {:.4}, PSNR {}, sharpness {:.1} -> {:.1} ({:.2}x), noise {:.2} -> {:.2}   [{:.0} ms]",
        report.ssim,
        report
            .psnr
            .map(|p| format!("{p:.1} dB"))
            .unwrap_or_else(|| "identical".into()),
        report.sharpness_before,
        report.sharpness_after,
        // The same guard the quality panel applies (ui/Quality.svelte): a
        // flat crop has no sharpness to divide by, and the honest answer
        // for "how much sharper" is then 1, not a number in the thousands.
        if report.sharpness_before > 0.01 {
            report.sharpness_after / report.sharpness_before
        } else {
            1.0
        },
        report.noise_before,
        report.noise_after,
        metrics_ms
    );
    println!(
        "        a Lanczos upscale should be faithful and NOT sharper: SSIM near 1, ratio near 1"
    );

    // ---- the decisions the app makes from the pixels ---------------------
    let chroma = color::mean_chroma(&img);
    println!(
        "\nchroma  {:.2} — the app {} colourisation (offered below ~4)",
        chroma,
        if chroma < 4.0 { "OFFERS" } else { "does not offer" }
    );

    let dscale = face::detect_scale(img.width, img.height);
    let di = face::detect_input(&img);
    let (dlo, dhi) = di.iter().fold((f32::MAX, f32::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    println!(
        "faces   letterboxed x{:.3} into {}x{} -> {} values in {:.0}..{:.0} (YuNet wants raw 0..255 BGR)",
        dscale,
        face::DETECT_INPUT,
        face::DETECT_INPUT,
        di.len(),
        dlo,
        dhi
    );

    let mi = matte::u2net_input(&img);
    let mmean = mi.iter().map(|v| *v as f64).sum::<f64>() / mi.len() as f64;
    let (mlo, mhi) = mi.iter().fold((f32::MAX, f32::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    println!(
        "matte   {}x{} -> {} values in {:.2}..{:.2}, mean {:.2} (U2Net wants ImageNet normalisation)",
        matte::INPUT,
        matte::INPUT,
        mi.len(),
        mlo,
        mhi,
        mmean
    );

    let ci = color::deoldify_input(&img, 256);
    let (clo, chi) = ci.iter().fold((f32::MAX, f32::MIN), |(a, b), v| (a.min(*v), b.max(*v)));
    println!(
        "colour  DeOldify input {} values in {:.0}..{:.0} (raw 0..255, grey replicated to 3 channels)",
        ci.len(),
        clo,
        chi
    );

    // ---- sharpening ------------------------------------------------------
    let t0 = Instant::now();
    let sharp = filters::unsharp(&merged, 1.0, 0.6, 3.0);
    let unsharp_ms = t0.elapsed().as_secs_f64() * 1000.0;
    let before = metrics::laplacian_variance(&merged.luma(), merged.width, merged.height);
    let after = metrics::laplacian_variance(&sharp.luma(), sharp.width, sharp.height);
    println!(
        "\nunsharp {:.0} ms over {:.1} MP — laplacian variance {:.1} -> {:.1} ({:+.1}%)",
        unsharp_ms,
        merged.width as f64 * merged.height as f64 / 1e6,
        before,
        after,
        (after / before - 1.0) * 100.0
    );
    println!();
}
