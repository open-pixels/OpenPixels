//! Sharpening.
//!
//! Unsharp masking, the same operation every photo editor calls "sharpen":
//! subtract a blurred copy, scale the difference, add it back. `radius` is
//! the blur sigma in pixels, `amount` the gain (1.0 = 100%), `threshold`
//! the minimum difference (0–255) that gets sharpened, which keeps flat
//! areas — sky, skin — from picking up grain.

use crate::metrics::{blur, gaussian_kernel};
use crate::Rgb;

pub fn unsharp(img: &Rgb, radius: f32, amount: f32, threshold: f32) -> Rgb {
    if amount <= 0.0 || radius <= 0.0 {
        return img.clone();
    }
    let taps = ((radius * 3.0).ceil() as usize * 2 + 1).max(3);
    let kernel = gaussian_kernel(taps, radius);
    let n = (img.width * img.height) as usize;
    let mut out = img.clone();
    for c in 0..3 {
        let plane: Vec<f32> = (0..n).map(|i| img.data[i * 3 + c] as f32).collect();
        let soft = blur(&plane, img.width, img.height, &kernel);
        for i in 0..n {
            let diff = plane[i] - soft[i];
            if diff.abs() >= threshold {
                out.data[i * 3 + c] = crate::q8(plane[i] + diff * amount);
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::laplacian_variance;
    use crate::testutil::synthetic;

    #[test]
    fn zero_amount_is_identity() {
        let img = synthetic(30, 20);
        assert_eq!(unsharp(&img, 1.0, 0.0, 0.0), img);
    }

    #[test]
    fn sharpening_raises_laplacian_variance() {
        let img = synthetic(64, 64);
        let sharp = unsharp(&img, 1.2, 1.0, 0.0);
        assert!(
            laplacian_variance(&sharp.luma(), 64, 64)
                > laplacian_variance(&img.luma(), 64, 64) * 1.3
        );
    }

    #[test]
    fn threshold_leaves_flat_regions_alone() {
        let mut img = Rgb::new(16, 16);
        img.data
            .iter_mut()
            .enumerate()
            .for_each(|(i, v)| *v = 100 + (i % 3) as u8); // nearly flat
        let out = unsharp(&img, 1.0, 2.0, 8.0);
        assert_eq!(out, img);
    }
}
