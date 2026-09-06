//! Tiling, so a model whose memory grows with the input never sees more
//! than a fixed-size patch, and the seams between patches are invisible.
//!
//! Each tile is a `tile × tile` core expanded by `overlap` on every side
//! that is not an image border. Neighbouring expanded tiles therefore share
//! a `2 × overlap` band. The model runs on the expanded tile; when its
//! output is merged, every pixel is weighted by a ramp that rises from 0
//! at a non-border edge to 1 at `overlap × scale` pixels in, and the sum is
//! normalised. Two overlapping ramps always add to something positive, so
//! the seam is a crossfade rather than a cut.
//!
//! # Why every tile is padded to the same size
//!
//! The tiles along the right and bottom edges are naturally smaller, and
//! feeding a model tensors of different shapes from one run to the next is
//! exactly what a dynamic-axis ONNX graph is for. It works on the CPU
//! backend and fails on WebGPU:
//!
//! ```text
//! Shape mismatch attempting to re-use buffer. {1,272,272,3} != {1,1088,1088,3}
//! ```
//!
//! onnxruntime plans its GPU buffers on the first run and reuses them; a
//! later run with a different shape finds a buffer of the wrong size, and
//! the error names an internal source path rather than the tile that
//! changed. Since WebGPU is the fast path — the one most people will
//! actually get — every tile is instead padded to one constant
//! `tile + 2 × overlap` square, so every run of a session has identical
//! shape. The padding replicates the edge pixel rather than filling with
//! black, because a hard black border is a strong edge and the model would
//! faithfully sharpen it into the result.
//!
//! [`plan`] also avoids slivers: where an image is wider than one tile, the
//! last column is shifted back to a full tile instead of being left as
//! whatever remains, so the padding is rarely more than a few percent of
//! wasted work.
//!
//! The merger accumulates in 16-bit fixed point rather than `f32`: a 40 MP
//! output is 320 MB this way instead of 640 MB, and phones notice.

use crate::Rgb;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Tile {
    /// Expanded region, in input pixels.
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TilePlan {
    pub width: u32,
    pub height: u32,
    pub tile: u32,
    pub overlap: u32,
    /// The square every tile is padded to before inference. Constant for
    /// the whole plan — see the module docs for why that matters.
    pub pad: u32,
    pub tiles: Vec<Tile>,
}

/// The starts of the tile cores along one axis.
///
/// Where the axis is longer than a tile, the last start is pulled back so
/// the final tile is full-width rather than a sliver — overlapping its
/// neighbour more, which the merge already handles, and costing far less
/// padding.
fn starts(length: u32, tile: u32) -> Vec<u32> {
    if length <= tile {
        return vec![0];
    }
    let mut out = Vec::new();
    let mut x = 0;
    while x + tile < length {
        out.push(x);
        x += tile;
    }
    out.push(length - tile);
    out
}

/// Plan tiles for a `width × height` input.
///
/// An image no larger than `tile` in both dimensions is a single tile with
/// no overlap, which is the common case on a phone photo.
pub fn plan(width: u32, height: u32, tile: u32, overlap: u32) -> TilePlan {
    let tile = tile.max(16);
    let mut tiles = Vec::new();
    for &y in &starts(height, tile) {
        let core_h = tile.min(height - y);
        for &x in &starts(width, tile) {
            let core_w = tile.min(width - x);
            let x0 = x.saturating_sub(overlap);
            let y0 = y.saturating_sub(overlap);
            let x1 = (x + core_w + overlap).min(width);
            let y1 = (y + core_h + overlap).min(height);
            tiles.push(Tile {
                x: x0,
                y: y0,
                w: x1 - x0,
                h: y1 - y0,
            });
        }
    }
    // Deliberately a pure function of the caller's tile settings, and not
    // of the image: it is the shape the model session is built around, and
    // a session whose shape depends on the photo would have to be rebuilt —
    // hundreds of milliseconds, and hundreds of megabytes — every time
    // someone opened a picture with different dimensions. A small photo
    // pays a little wasted work on replicated edge instead.
    let pad = tile + 2 * overlap;
    TilePlan {
        width,
        height,
        tile,
        overlap,
        pad,
        tiles,
    }
}

/// The expanded tile as a model input: NCHW `f32` in `[0, 1]`, padded to
/// `pad × pad` by replicating the tile's edge pixels.
pub fn extract(img: &Rgb, t: &Tile, pad: u32) -> Vec<f32> {
    let pad = pad.max(t.w).max(t.h);
    let plane = (pad * pad) as usize;
    let mut out = vec![0.0f32; plane * 3];
    for y in 0..pad {
        // Clamp into the tile: rows past its height repeat the last one.
        let sy = t.y + y.min(t.h - 1);
        for x in 0..pad {
            let sx = t.x + x.min(t.w - 1);
            let px = img.px(sx, sy);
            let i = (y * pad + x) as usize;
            out[i] = px[0] as f32 / 255.0;
            out[plane + i] = px[1] as f32 / 255.0;
            out[2 * plane + i] = px[2] as f32 / 255.0;
        }
    }
    out
}

/// Accumulates model outputs for every tile and produces the final image.
pub struct Merger {
    width: u32,
    height: u32,
    /// Weighted value sums, `value(0..255) * weight * 64`.
    acc: Vec<u16>,
    /// Weight sums, `weight * 8192`. At most four tiles meet at a point
    /// (a corner), so the sum never exceeds 4 × 8192.
    wsum: Vec<u16>,
}

const ACC_SCALE: f32 = 64.0;
const W_SCALE: f32 = 8192.0;

impl Merger {
    pub fn new(width: u32, height: u32) -> Self {
        let n = (width * height) as usize;
        Merger {
            width,
            height,
            acc: vec![0; n * 3],
            wsum: vec![0; n],
        }
    }

    pub fn width(&self) -> u32 {
        self.width
    }
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Add the model's output for `t`.
    ///
    /// `chw` is NCHW `f32` in `[0, 1]` at `(plan.pad × scale)` square — the
    /// padded shape every run produces. Only the top-left
    /// `(t.w × scale) × (t.h × scale)` of it is real; the rest is the
    /// model's rendering of the replicated edge and is discarded here.
    pub fn add(&mut self, plan: &TilePlan, t: &Tile, scale: u32, chw: &[f32]) {
        let ow = t.w * scale;
        let oh = t.h * scale;
        let stride = plan.pad.max(t.w).max(t.h) * scale;
        let plane = (stride * stride) as usize;
        assert!(
            chw.len() >= plane * 3,
            "tile output is {} values, expected {} for a {stride}x{stride} padded tile",
            chw.len(),
            plane * 3
        );
        let ramp = (plan.overlap * scale).max(1) as f32;

        // Which edges of this tile touch the image border (no ramp there).
        let left_border = t.x == 0;
        let top_border = t.y == 0;
        let right_border = t.x + t.w >= plan.width;
        let bottom_border = t.y + t.h >= plan.height;

        let wx: Vec<f32> = (0..ow)
            .map(|x| {
                let from_left = if left_border {
                    1.0
                } else {
                    ((x as f32 + 0.5) / ramp).min(1.0)
                };
                let from_right = if right_border {
                    1.0
                } else {
                    ((ow - x) as f32 - 0.5) / ramp
                }
                .min(1.0);
                from_left.min(from_right).max(1.0 / W_SCALE)
            })
            .collect();
        let wy: Vec<f32> = (0..oh)
            .map(|y| {
                let from_top = if top_border {
                    1.0
                } else {
                    ((y as f32 + 0.5) / ramp).min(1.0)
                };
                let from_bottom = if bottom_border {
                    1.0
                } else {
                    ((oh - y) as f32 - 0.5) / ramp
                }
                .min(1.0);
                from_top.min(from_bottom).max(1.0 / W_SCALE)
            })
            .collect();

        let ox = t.x * scale;
        let oy = t.y * scale;
        for y in 0..oh {
            let gy = oy + y;
            if gy >= self.height {
                break;
            }
            for x in 0..ow {
                let gx = ox + x;
                if gx >= self.width {
                    break;
                }
                let w = wx[x as usize] * wy[y as usize];
                let src = (y * stride + x) as usize;
                let dst = (gy * self.width + gx) as usize;
                for c in 0..3 {
                    let v = (chw[c * plane + src] * 255.0).clamp(0.0, 255.0);
                    self.acc[dst * 3 + c] =
                        self.acc[dst * 3 + c].saturating_add((v * w * ACC_SCALE).round() as u16);
                }
                self.wsum[dst] = self.wsum[dst].saturating_add((w * W_SCALE).round() as u16);
            }
        }
    }

    pub fn finish(&self) -> Rgb {
        let n = (self.width * self.height) as usize;
        let mut data = vec![0u8; n * 3];
        for i in 0..n {
            let w = self.wsum[i] as f32 / W_SCALE;
            if w <= 0.0 {
                continue;
            }
            for c in 0..3 {
                data[i * 3 + c] = crate::q8(self.acc[i * 3 + c] as f32 / ACC_SCALE / w);
            }
        }
        Rgb {
            width: self.width,
            height: self.height,
            data,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::synthetic;

    #[test]
    fn small_image_is_one_tile() {
        let p = plan(100, 80, 192, 16);
        assert_eq!(
            p.tiles,
            vec![Tile {
                x: 0,
                y: 0,
                w: 100,
                h: 80
            }]
        );
    }

    #[test]
    fn tiles_cover_the_image_with_overlap() {
        let p = plan(500, 300, 192, 16);
        // Columns start at 0, 192 and 308 (the last pulled back from 384 so
        // it is a full tile); rows at 0 and 108.
        assert_eq!(p.tiles.len(), 3 * 2);
        assert_eq!(
            p.tiles[0],
            Tile {
                x: 0,
                y: 0,
                w: 192 + 16,
                h: 192 + 16
            }
        );
        assert_eq!(
            p.tiles[1],
            Tile {
                x: 192 - 16,
                y: 0,
                w: 192 + 32,
                h: 192 + 16
            }
        );
        let last = p.tiles[2];
        assert_eq!(last.x + last.w, 500);
        // Every pixel is inside at least one tile.
        let mut covered = vec![false; 500 * 300];
        for t in &p.tiles {
            for y in t.y..t.y + t.h {
                for x in t.x..t.x + t.w {
                    covered[(y * 500 + x) as usize] = true;
                }
            }
        }
        assert!(covered.iter().all(|&c| c));
    }

    /// The property the WebGPU backend depends on: every tile of a plan is
    /// fed to the model at exactly the same shape.
    /// The property the WebGPU backend depends on: every tile of every plan
    /// built with the same tile settings is fed to the model at exactly one
    /// shape — including across images of different sizes, since the
    /// session is reused between them.
    #[test]
    fn every_tile_pads_to_one_constant_square() {
        let mut sizes = std::collections::BTreeSet::new();
        for (w, h) in [
            (500u32, 300u32),
            (288, 360),
            (37, 900),
            (60, 60),
            (2000, 1500),
        ] {
            let p = plan(w, h, 192, 16);
            assert_eq!(p.pad, 192 + 32, "pad must not depend on the image");
            let img = synthetic(w, h);
            for t in &p.tiles {
                assert!(
                    t.w <= p.pad && t.h <= p.pad,
                    "tile {t:?} exceeds pad {}",
                    p.pad
                );
                sizes.insert(extract(&img, t, p.pad).len());
            }
        }
        assert_eq!(sizes.len(), 1, "shapes varied: {sizes:?}");
        assert_eq!(*sizes.iter().next().unwrap(), (224 * 224 * 3) as usize);
    }

    /// A sliver column would be padded almost entirely with replicated
    /// pixels — the work the shifted last start exists to avoid.
    #[test]
    fn the_last_tile_is_not_a_sliver() {
        let p = plan(520, 200, 256, 16);
        let narrowest = p.tiles.iter().map(|t| t.w).min().unwrap();
        assert!(narrowest >= 256, "narrowest tile was {narrowest}");
    }

    #[test]
    fn padding_replicates_the_edge_rather_than_filling_with_black() {
        let img = synthetic(40, 40);
        let t = Tile {
            x: 0,
            y: 0,
            w: 40,
            h: 40,
        };
        let chw = extract(&img, &t, 64);
        let plane = 64 * 64;
        let at = |x: u32, y: u32| chw[(y * 64 + x) as usize] * 255.0;
        // Past the tile, every row repeats the last real column…
        assert!((at(50, 10) - at(39, 10)).abs() < 0.51);
        // …and every column repeats the last real row.
        assert!((at(10, 50) - at(10, 39)).abs() < 0.51);
        // Nothing is black unless the source was.
        assert!(chw[..plane].iter().any(|v| *v > 0.1));
    }

    /// An identity "model" (tile in, same tile out at 1×) merged back must
    /// reproduce the input exactly — the seam weights normalise away.
    #[test]
    fn identity_model_round_trips_exactly() {
        let img = synthetic(211, 137);
        let p = plan(211, 137, 64, 8);
        assert!(p.tiles.len() > 4);
        let mut m = Merger::new(211, 137);
        for t in &p.tiles {
            let chw = extract(&img, t, p.pad);
            m.add(&p, t, 1, &chw);
        }
        let out = m.finish();
        let max_err = out
            .data
            .iter()
            .zip(&img.data)
            .map(|(a, b)| (*a as i32 - *b as i32).abs())
            .max()
            .unwrap();
        assert!(max_err <= 1, "max error {max_err}");
    }

    /// A nearest-neighbour 2× "model" merged at scale 2 matches a direct
    /// nearest-neighbour upscale.
    #[test]
    fn scale_two_merge_matches_direct_upscale() {
        let img = synthetic(90, 70);
        let p = plan(90, 70, 32, 4);
        let mut m = Merger::new(180, 140);
        for t in &p.tiles {
            // A nearest-neighbour "model" over the padded tile, so the
            // shapes match what a real one would emit.
            let padded = Rgb::from_chw01(p.pad, p.pad, &extract(&img, t, p.pad));
            let up = crate::resize::resize(
                &padded,
                p.pad * 2,
                p.pad * 2,
                crate::resize::Filter::Nearest,
            );
            m.add(&p, t, 2, &up.to_chw01());
        }
        let out = m.finish();
        let want = crate::resize::resize(&img, 180, 140, crate::resize::Filter::Nearest);
        let max_err = out
            .data
            .iter()
            .zip(&want.data)
            .map(|(a, b)| (*a as i32 - *b as i32).abs())
            .max()
            .unwrap();
        assert!(max_err <= 1, "max error {max_err}");
    }

    /// Two tiles that disagree in the overlap band crossfade rather than
    /// jump: no adjacent-pixel step larger than the ramp allows.
    #[test]
    fn disagreeing_tiles_crossfade() {
        let p = plan(64, 8, 32, 8);
        assert_eq!(p.tiles.len(), 2);
        let mut m = Merger::new(64, 8);
        for (i, t) in p.tiles.iter().enumerate() {
            let v = if i == 0 { 0.0 } else { 1.0 };
            let chw = vec![v; (p.pad * p.pad * 3) as usize];
            m.add(&p, t, 1, &chw);
        }
        let out = m.finish();
        let row: Vec<u8> = (0..64).map(|x| out.px(x, 4)[0]).collect();
        assert_eq!(row[0], 0);
        assert_eq!(row[63], 255);
        let max_step = row
            .windows(2)
            .map(|w| (w[1] as i32 - w[0] as i32).abs())
            .max()
            .unwrap();
        assert!(max_step < 60, "step {max_step} across a 16px band");
        assert!(row.windows(2).all(|w| w[1] >= w[0]), "monotonic crossfade");
    }
}
