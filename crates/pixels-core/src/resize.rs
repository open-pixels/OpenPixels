//! Resampling, through the `image` crate's separable filters.
//!
//! Lanczos3 for anything the user will see (it keeps edges where bilinear
//! smears them), a triangle filter where speed matters and the result is
//! only a model input.

use crate::Rgb;
use image::imageops::{resize as im_resize, FilterType};
use image::RgbImage;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Filter {
    Lanczos3,
    Triangle,
    Nearest,
}

impl From<Filter> for FilterType {
    fn from(f: Filter) -> Self {
        match f {
            Filter::Lanczos3 => FilterType::Lanczos3,
            Filter::Triangle => FilterType::Triangle,
            Filter::Nearest => FilterType::Nearest,
        }
    }
}

pub fn resize(img: &Rgb, width: u32, height: u32, filter: Filter) -> Rgb {
    if width == img.width && height == img.height {
        return img.clone();
    }
    let src =
        RgbImage::from_raw(img.width, img.height, img.data.clone()).expect("valid RGB buffer");
    let out = im_resize(&src, width.max(1), height.max(1), filter.into());
    Rgb {
        width: out.width(),
        height: out.height(),
        data: out.into_raw(),
    }
}

/// Resize a single-channel `f32` plane with bilinear sampling. Used for
/// mattes and the colour planes a model emits at its own resolution.
pub fn resize_plane(src: &[f32], sw: u32, sh: u32, dw: u32, dh: u32) -> Vec<f32> {
    assert_eq!(src.len(), (sw * sh) as usize);
    if sw == dw && sh == dh {
        return src.to_vec();
    }
    let mut out = vec![0.0; (dw * dh) as usize];
    let sx = sw as f32 / dw as f32;
    let sy = sh as f32 / dh as f32;
    for y in 0..dh {
        let fy = ((y as f32 + 0.5) * sy - 0.5).clamp(0.0, (sh - 1) as f32);
        let y0 = fy.floor() as u32;
        let y1 = (y0 + 1).min(sh - 1);
        let ty = fy - y0 as f32;
        for x in 0..dw {
            let fx = ((x as f32 + 0.5) * sx - 0.5).clamp(0.0, (sw - 1) as f32);
            let x0 = fx.floor() as u32;
            let x1 = (x0 + 1).min(sw - 1);
            let tx = fx - x0 as f32;
            let p = |xx: u32, yy: u32| src[(yy * sw + xx) as usize];
            let top = p(x0, y0) * (1.0 - tx) + p(x1, y0) * tx;
            let bot = p(x0, y1) * (1.0 - tx) + p(x1, y1) * tx;
            out[(y * dw + x) as usize] = top * (1.0 - ty) + bot * ty;
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::synthetic;

    #[test]
    fn resize_changes_dimensions_and_keeps_flat_colour() {
        let mut img = Rgb::new(10, 10);
        img.data.iter_mut().for_each(|v| *v = 200);
        let up = resize(&img, 40, 30, Filter::Lanczos3);
        assert_eq!((up.width, up.height), (40, 30));
        assert!(up.data.iter().all(|&v| v == 200));
    }

    #[test]
    fn down_then_up_is_close_to_original_for_smooth_content() {
        let img = synthetic(64, 64);
        let small = resize(&img, 32, 32, Filter::Lanczos3);
        let back = resize(&small, 64, 64, Filter::Lanczos3);
        let psnr = crate::metrics::psnr(&img.luma(), &back.luma());
        assert!(psnr > 20.0, "psnr {psnr}");
    }

    #[test]
    fn plane_resize_is_identity_at_same_size_and_interpolates() {
        let p = vec![0.0, 1.0, 0.0, 1.0];
        assert_eq!(resize_plane(&p, 2, 2, 2, 2), p);
        let big = resize_plane(&p, 2, 2, 4, 2);
        assert!(big[0] < big[1] && big[1] < big[2] || big[1] <= big[2]);
        assert_eq!(big.len(), 8);
    }
}
