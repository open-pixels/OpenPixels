//! Everything around the forward pass.
//!
//! The browser runs the ONNX graphs through onnxruntime-web, because that
//! is the only way to reach WebGPU. Everything else — cutting an image into
//! tiles and merging the model's output back without seams, the quality
//! numbers, sharpening, the LAB arithmetic that colourisation needs, the
//! matte compositing, and the face alignment that GFPGAN expects — lives
//! here, once, and is tested natively with `cargo test`.
//!
//! Pixel layout throughout: `Rgb` is 8-bit interleaved RGB, row-major.
//! Model tensors are `f32` NCHW with a batch of one, which is what every
//! graph the app ships takes and emits.

// `chunks_exact(3)` reads as "one RGB pixel" everywhere in this crate, which
// is the point; `as_chunks` says the same thing less clearly and pins a newer
// toolchain than the workspace asks for.
#![allow(clippy::chunks_exact_to_as_chunks)]

pub mod color;
pub mod face;
pub mod filters;
pub mod matte;
pub mod metrics;
pub mod resize;
pub mod tile;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

/// An 8-bit interleaved RGB image.
#[derive(Clone, Debug, PartialEq)]
pub struct Rgb {
    pub width: u32,
    pub height: u32,
    pub data: Vec<u8>,
}

impl Rgb {
    pub fn new(width: u32, height: u32) -> Self {
        Rgb {
            width,
            height,
            data: vec![0; (width * height * 3) as usize],
        }
    }

    pub fn from_vec(width: u32, height: u32, data: Vec<u8>) -> Self {
        assert_eq!(data.len(), (width * height * 3) as usize, "RGB buffer size");
        Rgb {
            width,
            height,
            data,
        }
    }

    /// Drop the alpha channel of a canvas `ImageData` buffer.
    pub fn from_rgba(width: u32, height: u32, rgba: &[u8]) -> Self {
        let n = (width * height) as usize;
        assert_eq!(rgba.len(), n * 4, "RGBA buffer size");
        let mut data = Vec::with_capacity(n * 3);
        for px in rgba.as_chunks::<4>().0 {
            data.extend_from_slice(&px[..3]);
        }
        Rgb {
            width,
            height,
            data,
        }
    }

    /// Opaque RGBA, the layout a canvas wants back.
    pub fn to_rgba(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.data.len() / 3 * 4);
        for px in self.data.as_chunks::<3>().0 {
            out.extend_from_slice(px);
            out.push(255);
        }
        out
    }

    #[inline]
    pub fn px(&self, x: u32, y: u32) -> [u8; 3] {
        let i = ((y * self.width + x) * 3) as usize;
        [self.data[i], self.data[i + 1], self.data[i + 2]]
    }

    /// Planar `f32` NCHW in `[0, 1]`, the input every Real-ESRGAN graph takes.
    pub fn to_chw01(&self) -> Vec<f32> {
        let plane = (self.width * self.height) as usize;
        let mut out = vec![0.0; plane * 3];
        for (i, px) in self.data.as_chunks::<3>().0.iter().enumerate() {
            out[i] = px[0] as f32 / 255.0;
            out[plane + i] = px[1] as f32 / 255.0;
            out[2 * plane + i] = px[2] as f32 / 255.0;
        }
        out
    }

    /// The inverse of [`Rgb::to_chw01`], clamping — a model's output can
    /// stray a little outside the unit interval.
    pub fn from_chw01(width: u32, height: u32, chw: &[f32]) -> Self {
        let plane = (width * height) as usize;
        assert!(chw.len() >= plane * 3, "CHW buffer too small");
        let mut data = vec![0u8; plane * 3];
        for i in 0..plane {
            data[i * 3] = q8(chw[i] * 255.0);
            data[i * 3 + 1] = q8(chw[plane + i] * 255.0);
            data[i * 3 + 2] = q8(chw[2 * plane + i] * 255.0);
        }
        Rgb {
            width,
            height,
            data,
        }
    }

    /// Luma (Rec. 601), one `f32` per pixel in `0..=255`.
    pub fn luma(&self) -> Vec<f32> {
        self.data
            .as_chunks::<3>()
            .0
            .iter()
            .map(|p| 0.299 * p[0] as f32 + 0.587 * p[1] as f32 + 0.114 * p[2] as f32)
            .collect()
    }

    /// Copy out a rectangle. The rectangle must lie inside the image.
    pub fn crop(&self, x: u32, y: u32, w: u32, h: u32) -> Rgb {
        assert!(
            x + w <= self.width && y + h <= self.height,
            "crop outside image"
        );
        let mut data = Vec::with_capacity((w * h * 3) as usize);
        for row in y..y + h {
            let start = ((row * self.width + x) * 3) as usize;
            data.extend_from_slice(&self.data[start..start + (w * 3) as usize]);
        }
        Rgb {
            width: w,
            height: h,
            data,
        }
    }
}

/// Round and clamp to a byte.
#[inline]
pub(crate) fn q8(v: f32) -> u8 {
    v.round().clamp(0.0, 255.0) as u8
}

#[cfg(test)]
pub(crate) mod testutil {
    use super::Rgb;

    /// A deterministic test image with edges, gradients and texture, so
    /// filters and metrics have something to measure.
    pub fn synthetic(w: u32, h: u32) -> Rgb {
        let mut img = Rgb::new(w, h);
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) * 3) as usize;
                let checker = ((x / 8 + y / 8) % 2) as f32 * 120.0;
                let grad = 255.0 * x as f32 / w.max(1) as f32;
                let tex = 40.0 * ((x as f32 * 0.7).sin() * (y as f32 * 0.5).cos());
                img.data[i] = (checker + tex).clamp(0.0, 255.0) as u8;
                img.data[i + 1] = (grad * 0.6 + tex).clamp(0.0, 255.0) as u8;
                img.data[i + 2] = (255.0 - grad + checker * 0.3).clamp(0.0, 255.0) as u8;
            }
        }
        img
    }

    /// A pseudo-random noise field, seeded, in `[-amp, amp]`.
    pub fn noise(len: usize, amp: f32, mut seed: u32) -> Vec<f32> {
        (0..len)
            .map(|_| {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                ((seed % 20001) as f32 / 10000.0 - 1.0) * amp
            })
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn chw_round_trip() {
        let img = testutil::synthetic(13, 7);
        let back = Rgb::from_chw01(13, 7, &img.to_chw01());
        assert_eq!(img, back);
    }

    #[test]
    fn rgba_round_trip() {
        let img = testutil::synthetic(5, 4);
        let rgba = img.to_rgba();
        assert_eq!(rgba.len(), 5 * 4 * 4);
        assert!(rgba.iter().skip(3).step_by(4).all(|&a| a == 255));
        assert_eq!(Rgb::from_rgba(5, 4, &rgba), img);
    }

    #[test]
    fn crop_reads_the_right_pixels() {
        let img = testutil::synthetic(20, 20);
        let c = img.crop(3, 4, 5, 6);
        assert_eq!((c.width, c.height), (5, 6));
        assert_eq!(c.px(0, 0), img.px(3, 4));
        assert_eq!(c.px(4, 5), img.px(7, 9));
    }
}
