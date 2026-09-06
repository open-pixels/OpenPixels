//! Colour spaces and colourisation plumbing.
//!
//! DeOldify emits a full RGB image at its own working size. Using that
//! directly would throw away every pixel of detail in the original, so the
//! app keeps the original's lightness and takes only the colour (the a and
//! b of CIE L*a*b*) from the model, resampled up. That is what the original
//! DeOldify post-processing does too.

#![allow(clippy::excessive_precision)] // sRGB matrix constants, quoted from the spec

use crate::resize::{resize, resize_plane, Filter};
use crate::Rgb;

fn srgb_to_linear(c: f32) -> f32 {
    if c <= 0.04045 {
        c / 12.92
    } else {
        ((c + 0.055) / 1.055).powf(2.4)
    }
}

fn linear_to_srgb(c: f32) -> f32 {
    if c <= 0.0031308 {
        c * 12.92
    } else {
        1.055 * c.powf(1.0 / 2.4) - 0.055
    }
}

fn f_lab(t: f32) -> f32 {
    const D: f32 = 6.0 / 29.0;
    if t > D * D * D {
        t.cbrt()
    } else {
        t / (3.0 * D * D) + 4.0 / 29.0
    }
}

fn f_lab_inv(t: f32) -> f32 {
    const D: f32 = 6.0 / 29.0;
    if t > D {
        t * t * t
    } else {
        3.0 * D * D * (t - 4.0 / 29.0)
    }
}

/// sRGB (0–255) → CIE L*a*b* under D65.
pub fn rgb_to_lab(r: u8, g: u8, b: u8) -> [f32; 3] {
    let (r, g, b) = (
        srgb_to_linear(r as f32 / 255.0),
        srgb_to_linear(g as f32 / 255.0),
        srgb_to_linear(b as f32 / 255.0),
    );
    let x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
    let y = 0.2126729 * r + 0.7151522 * g + 0.0721750 * b;
    let z = (0.0193339 * r + 0.1191920 * g + 0.9503041 * b) / 1.08883;
    let (fx, fy, fz) = (f_lab(x), f_lab(y), f_lab(z));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn lab_to_linear(l: f32, a: f32, b: f32) -> [f32; 3] {
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let x = 0.95047 * f_lab_inv(fx);
    let y = f_lab_inv(fy);
    let z = 1.08883 * f_lab_inv(fz);
    [
        3.2404542 * x - 1.5371385 * y - 0.4985314 * z,
        -0.9692660 * x + 1.8760108 * y + 0.0415560 * z,
        0.0556434 * x - 0.2040259 * y + 1.0572252 * z,
    ]
}

/// CIE L*a*b* → sRGB (0–255), clamping out-of-gamut values per channel.
pub fn lab_to_rgb(l: f32, a: f32, b: f32) -> [u8; 3] {
    let lin = lab_to_linear(l, a, b);
    [
        crate::q8(linear_to_srgb(lin[0].clamp(0.0, 1.0)) * 255.0),
        crate::q8(linear_to_srgb(lin[1].clamp(0.0, 1.0)) * 255.0),
        crate::q8(linear_to_srgb(lin[2].clamp(0.0, 1.0)) * 255.0),
    ]
}

/// The same conversion, but when `(l, a, b)` is outside sRGB the *chroma*
/// is reduced until it fits instead of the channels being clipped.
///
/// This matters more than it sounds. The sRGB gamut is a thin sliver near
/// L = 0 and L = 100, so a colouriser that confidently paints a deep
/// shadow warm produces a triple that clipping resolves by *raising*
/// lightness — a black coat comes back dark brown and lifted, and the
/// detail the original had in it flattens. Pulling chroma toward the
/// neutral axis along constant L keeps the lightness the photograph
/// actually recorded and gives up only saturation, which is the half of
/// the answer the model was guessing at anyway.
///
/// Eight bisection steps put the residual error below a quantisation step.
pub fn lab_to_rgb_preserving_l(l: f32, a: f32, b: f32) -> [u8; 3] {
    const EPS: f32 = 1e-4;
    let fits = |t: f32| {
        lab_to_linear(l, a * t, b * t)
            .iter()
            .all(|v| *v >= -EPS && *v <= 1.0 + EPS)
    };
    if fits(1.0) {
        return lab_to_rgb(l, a, b);
    }
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..8 {
        let mid = (lo + hi) / 2.0;
        if fits(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    lab_to_rgb(l, a * lo, b * lo)
}

/// Mean chroma (√(a²+b²)) over the image, on a subsample. Below ~4 the
/// image is effectively monochrome — the cue to offer colourisation.
pub fn mean_chroma(img: &Rgb) -> f32 {
    let n = (img.width * img.height) as usize;
    let step = (n / 20_000).max(1);
    let mut sum = 0.0;
    let mut count = 0;
    let mut i = 0;
    while i < n {
        let p = &img.data[i * 3..i * 3 + 3];
        let lab = rgb_to_lab(p[0], p[1], p[2]);
        sum += (lab[1] * lab[1] + lab[2] * lab[2]).sqrt();
        count += 1;
        i += step;
    }
    if count == 0 {
        0.0
    } else {
        sum / count as f32
    }
}

/// DeOldify's input: the image as grey, replicated to three channels, in
/// `0..=255` (no normalisation — the graph carries its own), NCHW at
/// `size × size`.
pub fn deoldify_input(img: &Rgb, size: u32) -> Vec<f32> {
    let small = resize(img, size, size, Filter::Triangle);
    let plane = (size * size) as usize;
    let l = small.luma();
    let mut out = vec![0.0; plane * 3];
    for i in 0..plane {
        out[i] = l[i];
        out[plane + i] = l[i];
        out[2 * plane + i] = l[i];
    }
    out
}

/// Merge the model's colour into the original: L from `img`, a and b from
/// `chw` (RGB in `0..=255`, `size × size`), with `saturation` scaling the
/// chroma (1.0 = as the model produced it).
pub fn colorize_merge(img: &Rgb, chw: &[f32], size: u32, saturation: f32) -> Rgb {
    let plane = (size * size) as usize;
    assert!(chw.len() >= plane * 3, "colour tensor too small");
    // a and b at model resolution…
    let mut a_small = vec![0.0f32; plane];
    let mut b_small = vec![0.0f32; plane];
    for i in 0..plane {
        let lab = rgb_to_lab(
            crate::q8(chw[i]),
            crate::q8(chw[plane + i]),
            crate::q8(chw[2 * plane + i]),
        );
        a_small[i] = lab[1];
        b_small[i] = lab[2];
    }
    // …resampled to the original.
    let a = resize_plane(&a_small, size, size, img.width, img.height);
    let b = resize_plane(&b_small, size, size, img.width, img.height);

    let mut out = Rgb::new(img.width, img.height);
    let chroma = a.iter().zip(&b);
    for ((src, dst), (&ai, &bi)) in img
        .data
        .chunks_exact(3)
        .zip(out.data.chunks_exact_mut(3))
        .zip(chroma)
    {
        let l = rgb_to_lab(src[0], src[1], src[2])[0];
        dst.copy_from_slice(&lab_to_rgb_preserving_l(
            l,
            ai * saturation,
            bi * saturation,
        ));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::synthetic;

    #[test]
    fn lab_round_trips_within_a_step() {
        for &(r, g, b) in &[
            (0u8, 0u8, 0u8),
            (255, 255, 255),
            (200, 30, 90),
            (12, 200, 250),
            (128, 128, 128),
        ] {
            let [l, a, bb] = rgb_to_lab(r, g, b);
            let back = lab_to_rgb(l, a, bb);
            assert!(
                (back[0] as i32 - r as i32).abs() <= 1,
                "{:?}",
                (r, g, b, back)
            );
            assert!((back[1] as i32 - g as i32).abs() <= 1);
            assert!((back[2] as i32 - b as i32).abs() <= 1);
        }
        assert!((rgb_to_lab(255, 255, 255)[0] - 100.0).abs() < 0.1);
        let grey = rgb_to_lab(128, 128, 128);
        assert!(grey[1].abs() < 0.5 && grey[2].abs() < 0.5);
    }

    #[test]
    fn chroma_separates_colour_from_grey() {
        let colour = synthetic(40, 40);
        let mut grey = colour.clone();
        let l = grey.luma();
        for (i, v) in l.iter().enumerate() {
            grey.data[i * 3..i * 3 + 3].copy_from_slice(&[*v as u8; 3]);
        }
        assert!(mean_chroma(&grey) < 2.0);
        assert!(mean_chroma(&colour) > 10.0);
    }

    #[test]
    fn deoldify_input_is_grey_replicated_at_size() {
        let img = synthetic(50, 30);
        let x = deoldify_input(&img, 16);
        assert_eq!(x.len(), 16 * 16 * 3);
        assert_eq!(x[3], x[256 + 3]);
        assert_eq!(x[3], x[512 + 3]);
        assert!(x.iter().all(|v| (0.0..=255.0).contains(v)));
    }

    #[test]
    fn gamut_mapping_preserves_lightness_where_clipping_would_not() {
        // Near-black with a confident warm cast: outside sRGB entirely.
        let clipped = lab_to_rgb(0.0, 50.0, 40.0);
        let mapped = lab_to_rgb_preserving_l(0.0, 50.0, 40.0);
        assert!(
            rgb_to_lab(clipped[0], clipped[1], clipped[2])[0] > 8.0,
            "clipping does lift L"
        );
        assert!(
            rgb_to_lab(mapped[0], mapped[1], mapped[2])[0] < 1.0,
            "{mapped:?}"
        );
        // An in-gamut colour is untouched by the mapping.
        assert_eq!(
            lab_to_rgb_preserving_l(60.0, 10.0, -12.0),
            lab_to_rgb(60.0, 10.0, -12.0)
        );
    }

    #[test]
    fn colorize_keeps_lightness_and_takes_colour() {
        let mut grey = Rgb::new(8, 8);
        grey.data
            .iter_mut()
            .enumerate()
            .for_each(|(i, v)| *v = ((i / 3) * 4 % 256) as u8);
        // A model output that is uniformly red.
        let size = 4;
        let plane = (size * size) as usize;
        let mut chw = vec![0.0; plane * 3];
        chw[..plane].iter_mut().for_each(|v| *v = 200.0);
        chw[plane..2 * plane].iter_mut().for_each(|v| *v = 40.0);
        chw[2 * plane..].iter_mut().for_each(|v| *v = 40.0);
        let out = colorize_merge(&grey, &chw, size, 1.0);
        // Reddish everywhere, and lightness preserved — including in the
        // darkest pixels, where naive clipping would lift L.
        for i in 0..64 {
            let p = &out.data[i * 3..i * 3 + 3];
            assert!(p[0] >= p[1] && p[0] >= p[2], "{p:?}");
            let l_in = rgb_to_lab(grey.data[i * 3], grey.data[i * 3], grey.data[i * 3])[0];
            let l_out = rgb_to_lab(p[0], p[1], p[2])[0];
            assert!((l_in - l_out).abs() < 3.0, "{l_in} vs {l_out}");
        }
        // Zero saturation gives grey back.
        let neutral = colorize_merge(&grey, &chw, size, 0.0);
        assert!(neutral
            .data
            .iter()
            .zip(&grey.data)
            .all(|(a, b)| (*a as i32 - *b as i32).abs() <= 1));
    }
}
