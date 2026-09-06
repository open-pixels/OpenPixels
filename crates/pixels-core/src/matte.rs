//! Background removal plumbing around U²-Net-p.
//!
//! The graph takes a 320×320 ImageNet-normalised RGB tensor and emits seven
//! saliency maps; the first (`d0`) is the fused result. It is not a
//! calibrated probability, so — as rembg does — it is stretched to its own
//! min/max before being resampled to the source size and used as alpha.

use crate::resize::{resize, resize_plane, Filter};
use crate::Rgb;

pub const INPUT: u32 = 320;
const MEAN: [f32; 3] = [0.485, 0.456, 0.406];
const STD: [f32; 3] = [0.229, 0.224, 0.225];

pub fn u2net_input(img: &Rgb) -> Vec<f32> {
    let small = resize(img, INPUT, INPUT, Filter::Triangle);
    let plane = (INPUT * INPUT) as usize;
    let mut out = vec![0.0; plane * 3];
    for (i, px) in small.data.as_chunks::<3>().0.iter().enumerate() {
        for c in 0..3 {
            out[c * plane + i] = (px[c] as f32 / 255.0 - MEAN[c]) / STD[c];
        }
    }
    out
}

/// `d0` (`INPUT × INPUT`) → an 8-bit alpha plane at `width × height`.
pub fn matte_from_output(d0: &[f32], width: u32, height: u32) -> Vec<u8> {
    let plane = (INPUT * INPUT) as usize;
    assert!(d0.len() >= plane, "d0 too small");
    let d0 = &d0[..plane];
    let (mut lo, mut hi) = (f32::INFINITY, f32::NEG_INFINITY);
    for &v in d0 {
        lo = lo.min(v);
        hi = hi.max(v);
    }
    let range = (hi - lo).max(1e-6);
    let stretched: Vec<f32> = d0.iter().map(|v| (v - lo) / range).collect();
    let full = resize_plane(&stretched, INPUT, INPUT, width, height);
    full.iter().map(|v| crate::q8(v * 255.0)).collect()
}

// A transparent PNG is assembled by the encoder on the main thread, which
// already walks every pixel to build an `ImageData`; adding the alpha there
// costs nothing, where doing it here would mean shipping a second buffer
// across the worker boundary for the caller to interleave anyway.

/// Composite over a solid colour.
pub fn replace_background(img: &Rgb, matte: &[u8], colour: [u8; 3]) -> Rgb {
    let n = (img.width * img.height) as usize;
    assert_eq!(matte.len(), n, "matte size");
    let mut out = Rgb::new(img.width, img.height);
    for ((src, dst), &m) in img
        .data
        .chunks_exact(3)
        .zip(out.data.chunks_exact_mut(3))
        .zip(matte)
    {
        let a = m as f32 / 255.0;
        for ((d, s), &bg) in dst.iter_mut().zip(src).zip(&colour) {
            *d = crate::q8(*s as f32 * a + bg as f32 * (1.0 - a));
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::synthetic;

    #[test]
    fn input_is_normalised_at_320() {
        let x = u2net_input(&synthetic(100, 60));
        assert_eq!(x.len(), 320 * 320 * 3);
        // ImageNet normalisation puts values roughly in [-2.2, 2.7].
        assert!(x.iter().all(|v| *v > -2.2 && *v < 2.7));
    }

    #[test]
    fn matte_is_stretched_and_resized() {
        let mut d0 = vec![0.2f32; 320 * 320];
        d0.iter_mut().skip(320 * 160).for_each(|v| *v = 0.6); // bottom half "foreground"
        let m = matte_from_output(&d0, 10, 10);
        assert_eq!(m.len(), 100);
        assert_eq!(m[0], 0);
        assert_eq!(m[99], 255);
    }

    #[test]
    fn compositing() {
        let img = synthetic(4, 4);
        let matte = vec![
            255, 0, 128, 255, 255, 0, 128, 255, 255, 0, 128, 255, 255, 0, 128, 255,
        ];
        let over = replace_background(&img, &matte, [0, 0, 0]);
        assert_eq!(over.px(0, 0), img.px(0, 0));
        assert_eq!(over.px(1, 0), [0, 0, 0]);
        let half = over.px(2, 0);
        let src = img.px(2, 0);
        assert!((half[0] as i32 * 2 - src[0] as i32).abs() <= 2);
    }
}
