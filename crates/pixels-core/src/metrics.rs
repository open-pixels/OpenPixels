//! The numbers behind the compare slider.
//!
//! Nobody else in this category shows any, so the choice of *which* is
//! deliberate:
//!
//! - **Fidelity** (PSNR, SSIM): the output shrunk back to the input size
//!   against the input. There is no ground-truth high-resolution image, so
//!   this is the honest reference-based number: high means the model
//!   enlarged what was there rather than inventing something else.
//! - **Sharpness**: variance of the Laplacian, output against the same
//!   input enlarged with a plain resampler. The ratio is "how much sharper
//!   than just making it bigger".
//! - **Noise**: Immerkær's fast estimator, on the input and on the output,
//!   each at its own scale — what someone sees at 100%.

use crate::resize::{resize, Filter};
use crate::Rgb;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Report {
    pub input_width: u32,
    pub input_height: u32,
    pub output_width: u32,
    pub output_height: u32,
    /// dB, output shrunk to input size vs input. `None` when identical.
    pub psnr: Option<f32>,
    pub ssim: f32,
    pub sharpness_before: f32,
    pub sharpness_after: f32,
    pub noise_before: f32,
    pub noise_after: f32,
}

/// Peak signal-to-noise ratio in dB for 8-bit planes. Infinite when
/// identical, which callers should treat as "no difference".
pub fn psnr(a: &[f32], b: &[f32]) -> f32 {
    assert_eq!(a.len(), b.len());
    let mse = a.iter().zip(b).map(|(x, y)| (x - y) * (x - y)).sum::<f32>() / a.len().max(1) as f32;
    if mse <= 0.0 {
        f32::INFINITY
    } else {
        10.0 * (255.0 * 255.0 / mse).log10()
    }
}

/// Structural similarity (Wang et al. 2004) on a luma plane, with the
/// standard 11-tap Gaussian window (σ = 1.5) and constants for 8-bit data.
pub fn ssim(a: &[f32], b: &[f32], w: u32, h: u32) -> f32 {
    assert_eq!(a.len(), (w * h) as usize);
    assert_eq!(b.len(), a.len());
    let c1 = (0.01f32 * 255.0).powi(2);
    let c2 = (0.03f32 * 255.0).powi(2);
    let kernel = gaussian_kernel(11, 1.5);

    let mu_a = blur(a, w, h, &kernel);
    let mu_b = blur(b, w, h, &kernel);
    let aa: Vec<f32> = a.iter().map(|v| v * v).collect();
    let bb: Vec<f32> = b.iter().map(|v| v * v).collect();
    let ab: Vec<f32> = a.iter().zip(b).map(|(x, y)| x * y).collect();
    let s_aa = blur(&aa, w, h, &kernel);
    let s_bb = blur(&bb, w, h, &kernel);
    let s_ab = blur(&ab, w, h, &kernel);

    let mut sum = 0.0;
    for i in 0..a.len() {
        let va = s_aa[i] - mu_a[i] * mu_a[i];
        let vb = s_bb[i] - mu_b[i] * mu_b[i];
        let cov = s_ab[i] - mu_a[i] * mu_b[i];
        let num = (2.0 * mu_a[i] * mu_b[i] + c1) * (2.0 * cov + c2);
        let den = (mu_a[i] * mu_a[i] + mu_b[i] * mu_b[i] + c1) * (va + vb + c2);
        sum += num / den;
    }
    (sum / a.len().max(1) as f32).clamp(-1.0, 1.0)
}

/// Variance of the 3×3 Laplacian: the usual focus/sharpness measure.
pub fn laplacian_variance(p: &[f32], w: u32, h: u32) -> f32 {
    if w < 3 || h < 3 {
        return 0.0;
    }
    let (w, h) = (w as usize, h as usize);
    let mut vals = Vec::with_capacity((w - 2) * (h - 2));
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let i = y * w + x;
            let lap = -4.0 * p[i] + p[i - 1] + p[i + 1] + p[i - w] + p[i + w];
            vals.push(lap);
        }
    }
    variance(&vals)
}

/// Immerkær (1996): σ ≈ √(π/2) · Σ|I ∗ M| / (6 (W−2)(H−2)) with
/// M = [1 −2 1; −2 4 −2; 1 −2 1]. Cheap, and insensitive to edges.
pub fn noise_sigma(p: &[f32], w: u32, h: u32) -> f32 {
    if w < 3 || h < 3 {
        return 0.0;
    }
    let (w, h) = (w as usize, h as usize);
    let mut sum = 0.0f64;
    for y in 1..h - 1 {
        for x in 1..w - 1 {
            let i = y * w + x;
            let v = 4.0 * p[i] - 2.0 * (p[i - 1] + p[i + 1] + p[i - w] + p[i + w])
                + p[i - w - 1]
                + p[i - w + 1]
                + p[i + w - 1]
                + p[i + w + 1];
            sum += v.abs() as f64;
        }
    }
    (sum * (std::f64::consts::PI / 2.0).sqrt() / (6.0 * (w - 2) as f64 * (h - 2) as f64)) as f32
}

/// The full report for the compare panel.
pub fn report(input: &Rgb, output: &Rgb) -> Report {
    // Fidelity at the input's scale.
    let shrunk = resize(output, input.width, input.height, Filter::Lanczos3);
    let li = input.luma();
    let ls = shrunk.luma();
    let p = psnr(&li, &ls);
    let s = ssim(&li, &ls, input.width, input.height);

    // Sharpness at the output's scale, on a window so a 40 MP output does
    // not take seconds to score. Both sides get the same window.
    let (win_w, win_h) = (output.width.min(1024), output.height.min(1024));
    let wx = (output.width - win_w) / 2;
    let wy = (output.height - win_h) / 2;
    let baseline = resize(input, output.width, output.height, Filter::Lanczos3);
    let after = output.crop(wx, wy, win_w, win_h).luma();
    let before = baseline.crop(wx, wy, win_w, win_h).luma();

    // Noise, each at its own scale, on a comparable window.
    let (nw, nh) = (input.width.min(1024), input.height.min(1024));
    let nin = input
        .crop((input.width - nw) / 2, (input.height - nh) / 2, nw, nh)
        .luma();

    Report {
        input_width: input.width,
        input_height: input.height,
        output_width: output.width,
        output_height: output.height,
        psnr: if p.is_finite() { Some(p) } else { None },
        ssim: s,
        sharpness_before: laplacian_variance(&before, win_w, win_h),
        sharpness_after: laplacian_variance(&after, win_w, win_h),
        noise_before: noise_sigma(&nin, nw, nh),
        noise_after: noise_sigma(&after, win_w, win_h),
    }
}

// ------------------------------------------------------------------ helpers

fn variance(v: &[f32]) -> f32 {
    if v.is_empty() {
        return 0.0;
    }
    let mean = v.iter().sum::<f32>() / v.len() as f32;
    v.iter().map(|x| (x - mean) * (x - mean)).sum::<f32>() / v.len() as f32
}

pub(crate) fn gaussian_kernel(taps: usize, sigma: f32) -> Vec<f32> {
    let half = (taps / 2) as i32;
    let mut k: Vec<f32> = (-half..=half)
        .map(|i| (-(i * i) as f32 / (2.0 * sigma * sigma)).exp())
        .collect();
    let sum: f32 = k.iter().sum();
    k.iter_mut().for_each(|v| *v /= sum);
    k
}

/// Separable convolution with edge clamping.
pub(crate) fn blur(p: &[f32], w: u32, h: u32, kernel: &[f32]) -> Vec<f32> {
    let (w, h) = (w as usize, h as usize);
    let half = (kernel.len() / 2) as isize;
    let mut tmp = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut acc = 0.0;
            for (k, kv) in kernel.iter().enumerate() {
                let sx = (x as isize + k as isize - half).clamp(0, w as isize - 1) as usize;
                acc += p[y * w + sx] * kv;
            }
            tmp[y * w + x] = acc;
        }
    }
    let mut out = vec![0.0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut acc = 0.0;
            for (k, kv) in kernel.iter().enumerate() {
                let sy = (y as isize + k as isize - half).clamp(0, h as isize - 1) as usize;
                acc += tmp[sy * w + x] * kv;
            }
            out[y * w + x] = acc;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::{noise, synthetic};

    #[test]
    fn psnr_of_identical_is_infinite_and_known_offset_matches_formula() {
        let a = vec![100.0; 64];
        assert!(psnr(&a, &a).is_infinite());
        let b = vec![110.0; 64]; // mse = 100 → 10 log10(65025/100) = 28.13
        let p = psnr(&a, &b);
        assert!((p - 28.13).abs() < 0.01, "{p}");
    }

    #[test]
    fn ssim_is_one_for_identical_and_lower_for_noisy() {
        let img = synthetic(48, 40);
        let l = img.luma();
        assert!((ssim(&l, &l, 48, 40) - 1.0).abs() < 1e-4);
        let noisy: Vec<f32> = l
            .iter()
            .zip(noise(l.len(), 25.0, 7))
            .map(|(v, n)| (v + n).clamp(0.0, 255.0))
            .collect();
        let s = ssim(&l, &noisy, 48, 40);
        assert!(s < 0.9 && s > 0.0, "{s}");
    }

    #[test]
    fn blurred_is_less_sharp_and_noisy_is_noisier() {
        let img = synthetic(64, 64);
        let l = img.luma();
        let sharp = laplacian_variance(&l, 64, 64);
        let soft = blur(&l, 64, 64, &gaussian_kernel(9, 2.0));
        assert!(laplacian_variance(&soft, 64, 64) < sharp * 0.5);

        let clean = noise_sigma(&soft, 64, 64);
        let noisy: Vec<f32> = soft
            .iter()
            .zip(noise(l.len(), 20.0, 3))
            .map(|(v, n)| v + n)
            .collect();
        let est = noise_sigma(&noisy, 64, 64);
        assert!(est > clean + 5.0, "clean {clean} noisy {est}");
        // Uniform noise in [-20, 20] has σ ≈ 11.5; the estimator should land
        // in the neighbourhood, not an order of magnitude off.
        assert!(est > 6.0 && est < 20.0, "{est}");
    }

    #[test]
    fn report_on_a_plain_upscale_is_faithful_and_not_sharper() {
        let img = synthetic(80, 60);
        let up = resize(&img, 160, 120, Filter::Lanczos3);
        let r = report(&img, &up);
        assert_eq!((r.output_width, r.output_height), (160, 120));
        assert!(r.psnr.unwrap() > 25.0, "{:?}", r.psnr);
        assert!(r.ssim > 0.8, "{}", r.ssim);
        let ratio = r.sharpness_after / r.sharpness_before;
        assert!(
            (ratio - 1.0).abs() < 0.1,
            "a resample of a resample: {ratio}"
        );
    }

    #[test]
    fn report_serialises() {
        let img = synthetic(20, 20);
        let json = serde_json::to_string(&report(&img, &img)).unwrap();
        assert!(json.contains("\"psnr\":null"));
        assert!(json.contains("\"ssim\":"));
    }
}
