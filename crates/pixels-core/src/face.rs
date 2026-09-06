//! Faces: detection (YuNet) and the alignment GFPGAN expects.
//!
//! GFPGAN was trained on FFHQ crops: a 512×512 image in which the five
//! landmarks (eyes, nose tip, mouth corners) sit at fixed positions. So a
//! face is *aligned* into that frame with a similarity transform (rotate,
//! scale, translate — no shear), restored, and pasted back through the
//! inverse transform with a feathered mask so the square is invisible.
//!
//! The paste target is usually the *upscaled* image, so the paste takes the
//! ratio between the target and the frame the landmarks were found in.

use crate::resize::{resize, Filter};
use crate::Rgb;
use serde::{Deserialize, Serialize};

// ------------------------------------------------------------ detection

/// YuNet's square input edge. The image is letterboxed into it,
/// top-left-anchored, matching OpenCV's flow.
pub const DETECT_INPUT: u32 = 640;
pub const STRIDES: [u32; 3] = [8, 16, 32];
const SCORE_THRESHOLD: f32 = 0.6;
const NMS_IOU: f32 = 0.3;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Face {
    pub score: f32,
    /// `[x, y, w, h]` in source pixels.
    pub bbox: [f32; 4],
    /// Right eye, left eye, nose, right mouth corner, left mouth corner —
    /// "right" meaning the person's right, i.e. smaller x in the image.
    pub landmarks: [[f32; 2]; 5],
}

/// The four per-stride head tensors, as the ONNX graph emits them.
pub struct StrideHeads<'a> {
    pub stride: u32,
    pub cls: &'a [f32],
    pub obj: &'a [f32],
    pub bbox: &'a [f32],
    pub kps: &'a [f32],
}

/// Scale factor from source to the 640 frame.
pub fn detect_scale(width: u32, height: u32) -> f32 {
    DETECT_INPUT as f32 / width.max(height).max(1) as f32
}

/// Letterbox into 640×640 and fill an NCHW **BGR** tensor of raw 0–255
/// values, which is what YuNet is trained on.
pub fn detect_input(img: &Rgb) -> Vec<f32> {
    let scale = detect_scale(img.width, img.height);
    let nw = ((img.width as f32 * scale).round() as u32).clamp(1, DETECT_INPUT);
    let nh = ((img.height as f32 * scale).round() as u32).clamp(1, DETECT_INPUT);
    let resized = resize(img, nw, nh, Filter::Triangle);
    let plane = (DETECT_INPUT * DETECT_INPUT) as usize;
    let mut input = vec![0.0f32; 3 * plane];
    for y in 0..nh {
        for x in 0..nw {
            let p = resized.px(x, y);
            let i = (y * DETECT_INPUT + x) as usize;
            input[i] = p[2] as f32;
            input[plane + i] = p[1] as f32;
            input[2 * plane + i] = p[0] as f32;
        }
    }
    input
}

/// Decode the strided heads into faces in source pixels, best first,
/// NMS-filtered. `scale` is [`detect_scale`] of the source.
pub fn detect_decode(heads: &[StrideHeads<'_>], scale: f32) -> Vec<Face> {
    let mut faces = Vec::new();
    for head in heads {
        let stride = head.stride;
        let cols = (DETECT_INPUT / stride) as usize;
        let n = cols * cols;
        if head.cls.len() < n
            || head.obj.len() < n
            || head.bbox.len() < n * 4
            || head.kps.len() < n * 10
        {
            continue;
        }
        for r in 0..cols {
            for c in 0..cols {
                let i = r * cols + c;
                let score = (head.cls[i].clamp(0.0, 1.0) * head.obj[i].clamp(0.0, 1.0)).sqrt();
                if score < SCORE_THRESHOLD {
                    continue;
                }
                let s = stride as f32;
                let cx = (c as f32 + head.bbox[i * 4]) * s;
                let cy = (r as f32 + head.bbox[i * 4 + 1]) * s;
                let bw = head.bbox[i * 4 + 2].exp() * s;
                let bh = head.bbox[i * 4 + 3].exp() * s;
                let mut landmarks = [[0.0f32; 2]; 5];
                for (k, lm) in landmarks.iter_mut().enumerate() {
                    lm[0] = (c as f32 + head.kps[i * 10 + k * 2]) * s / scale;
                    lm[1] = (r as f32 + head.kps[i * 10 + k * 2 + 1]) * s / scale;
                }
                faces.push(Face {
                    score,
                    bbox: [
                        (cx - bw / 2.0) / scale,
                        (cy - bh / 2.0) / scale,
                        bw / scale,
                        bh / scale,
                    ],
                    landmarks,
                });
            }
        }
    }
    faces.sort_by(|a, b| b.score.total_cmp(&a.score));
    nms(faces)
}

fn iou(a: &[f32; 4], b: &[f32; 4]) -> f32 {
    let x1 = a[0].max(b[0]);
    let y1 = a[1].max(b[1]);
    let x2 = (a[0] + a[2]).min(b[0] + b[2]);
    let y2 = (a[1] + a[3]).min(b[1] + b[3]);
    let inter = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
    let union = a[2] * a[3] + b[2] * b[3] - inter;
    if union <= 0.0 {
        0.0
    } else {
        inter / union
    }
}

fn nms(sorted: Vec<Face>) -> Vec<Face> {
    let mut keep: Vec<Face> = Vec::new();
    for face in sorted {
        if keep.iter().all(|k| iou(&k.bbox, &face.bbox) < NMS_IOU) {
            keep.push(face);
        }
    }
    keep
}

// ------------------------------------------------------------ alignment

/// GFPGAN's working frame.
pub const FACE_SIZE: u32 = 512;

/// Where FFHQ puts the five landmarks in a 512 crop.
pub const TEMPLATE: [[f32; 2]; 5] = [
    [192.98138, 239.94708],
    [318.90277, 240.1936],
    [256.63416, 314.01935],
    [201.26117, 371.41043],
    [313.08905, 371.15118],
];

/// A similarity transform `(x, y) ↦ (a·x − b·y + tx, b·x + a·y + ty)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Similarity {
    pub a: f32,
    pub b: f32,
    pub tx: f32,
    pub ty: f32,
}

impl Similarity {
    /// Least-squares fit mapping `src` onto `dst` (Umeyama without
    /// reflection, in closed form for the planar case).
    pub fn fit(src: &[[f32; 2]], dst: &[[f32; 2]]) -> Similarity {
        assert_eq!(src.len(), dst.len());
        let n = src.len() as f32;
        let (mut sx, mut sy, mut ux, mut uy) = (0.0, 0.0, 0.0, 0.0);
        for (p, q) in src.iter().zip(dst) {
            sx += p[0];
            sy += p[1];
            ux += q[0];
            uy += q[1];
        }
        let (sx, sy, ux, uy) = (sx / n, sy / n, ux / n, uy / n);
        let (mut num_a, mut num_b, mut den) = (0.0, 0.0, 0.0);
        for (p, q) in src.iter().zip(dst) {
            let (x, y) = (p[0] - sx, p[1] - sy);
            let (u, v) = (q[0] - ux, q[1] - uy);
            num_a += x * u + y * v;
            num_b += x * v - y * u;
            den += x * x + y * y;
        }
        let den = if den.abs() < 1e-9 { 1e-9 } else { den };
        let a = num_a / den;
        let b = num_b / den;
        Similarity {
            a,
            b,
            tx: ux - a * sx + b * sy,
            ty: uy - b * sx - a * sy,
        }
    }

    #[inline]
    pub fn apply(&self, x: f32, y: f32) -> (f32, f32) {
        (
            self.a * x - self.b * y + self.tx,
            self.b * x + self.a * y + self.ty,
        )
    }

    #[inline]
    pub fn invert(&self, u: f32, v: f32) -> (f32, f32) {
        let du = u - self.tx;
        let dv = v - self.ty;
        let s2 = self.a * self.a + self.b * self.b;
        (
            (self.a * du + self.b * dv) / s2,
            (self.a * dv - self.b * du) / s2,
        )
    }

    pub fn scale(&self) -> f32 {
        (self.a * self.a + self.b * self.b).sqrt()
    }
}

/// Order the landmarks the way the template expects, whatever the detector
/// called them: the eye and mouth corner with the smaller x go first.
pub fn canonical(landmarks: &[[f32; 2]; 5]) -> [[f32; 2]; 5] {
    let mut l = *landmarks;
    if l[0][0] > l[1][0] {
        l.swap(0, 1);
    }
    if l[3][0] > l[4][0] {
        l.swap(3, 4);
    }
    l
}

pub fn alignment(landmarks: &[[f32; 2]; 5]) -> Similarity {
    Similarity::fit(&canonical(landmarks), &TEMPLATE)
}

fn sample(img: &Rgb, x: f32, y: f32) -> Option<[f32; 3]> {
    if x < -0.5 || y < -0.5 || x > img.width as f32 - 0.5 || y > img.height as f32 - 0.5 {
        return None;
    }
    let x = x.clamp(0.0, (img.width - 1) as f32);
    let y = y.clamp(0.0, (img.height - 1) as f32);
    let x0 = x.floor() as u32;
    let y0 = y.floor() as u32;
    let x1 = (x0 + 1).min(img.width - 1);
    let y1 = (y0 + 1).min(img.height - 1);
    let tx = x - x0 as f32;
    let ty = y - y0 as f32;
    let p00 = img.px(x0, y0);
    let p10 = img.px(x1, y0);
    let p01 = img.px(x0, y1);
    let p11 = img.px(x1, y1);
    let mut out = [0.0; 3];
    for c in 0..3 {
        let top = p00[c] as f32 * (1.0 - tx) + p10[c] as f32 * tx;
        let bot = p01[c] as f32 * (1.0 - tx) + p11[c] as f32 * tx;
        out[c] = top * (1.0 - ty) + bot * ty;
    }
    Some(out)
}

/// The aligned 512×512 crop as GFPGAN's input: NCHW RGB in `[-1, 1]`.
/// Pixels outside the source are filled with the neutral grey GFPGAN's
/// own pre-processing uses.
pub fn face_crop(img: &Rgb, landmarks: &[[f32; 2]; 5]) -> Vec<f32> {
    let t = alignment(landmarks);
    let plane = (FACE_SIZE * FACE_SIZE) as usize;
    let mut out = vec![0.0; plane * 3];
    for v in 0..FACE_SIZE {
        for u in 0..FACE_SIZE {
            let (x, y) = t.invert(u as f32, v as f32);
            let p = sample(img, x, y).unwrap_or([135.0, 133.0, 132.0]);
            let i = (v * FACE_SIZE + u) as usize;
            for c in 0..3 {
                out[c * plane + i] = p[c] / 127.5 - 1.0;
            }
        }
    }
    out
}

/// Paste a restored face (`chw`, NCHW RGB in `[-1, 1]`, 512×512) back into
/// `target`, whose size is `ratio` times the frame `landmarks` are in.
/// `feather` is the width in crop pixels of the blend at the square's
/// edge; `strength` (0–1) blends the restoration against the original.
pub fn face_paste(
    target: &mut Rgb,
    ratio: f32,
    landmarks: &[[f32; 2]; 5],
    chw: &[f32],
    feather: f32,
    strength: f32,
) {
    let plane = (FACE_SIZE * FACE_SIZE) as usize;
    assert!(chw.len() >= plane * 3, "restored face tensor too small");
    let t = alignment(landmarks);
    let restored = {
        let mut data = vec![0u8; plane * 3];
        for i in 0..plane {
            for c in 0..3 {
                data[i * 3 + c] = crate::q8((chw[c * plane + i] + 1.0) * 127.5);
            }
        }
        Rgb {
            width: FACE_SIZE,
            height: FACE_SIZE,
            data,
        }
    };
    let feather = feather.max(1.0);

    // Bounding box of the crop square in target pixels.
    let corners = [
        (0.0, 0.0),
        (FACE_SIZE as f32, 0.0),
        (0.0, FACE_SIZE as f32),
        (FACE_SIZE as f32, FACE_SIZE as f32),
    ];
    let (mut x0, mut y0, mut x1, mut y1) = (
        f32::INFINITY,
        f32::INFINITY,
        f32::NEG_INFINITY,
        f32::NEG_INFINITY,
    );
    for (u, v) in corners {
        let (x, y) = t.invert(u, v);
        x0 = x0.min(x * ratio);
        y0 = y0.min(y * ratio);
        x1 = x1.max(x * ratio);
        y1 = y1.max(y * ratio);
    }
    let x0 = x0.floor().max(0.0) as u32;
    let y0 = y0.floor().max(0.0) as u32;
    let x1 = (x1.ceil().max(0.0) as u32).min(target.width);
    let y1 = (y1.ceil().max(0.0) as u32).min(target.height);

    let edge = FACE_SIZE as f32;
    for gy in y0..y1 {
        for gx in x0..x1 {
            let x = (gx as f32 + 0.5) / ratio - 0.5;
            let y = (gy as f32 + 0.5) / ratio - 0.5;
            let (u, v) = t.apply(x, y);
            if u < 0.0 || v < 0.0 || u >= edge || v >= edge {
                continue;
            }
            let dist = (u + 0.5)
                .min(v + 0.5)
                .min(edge - u - 0.5)
                .min(edge - v - 0.5);
            // Ease the ramp so the blend has no visible start line.
            let a = (dist / feather).clamp(0.0, 1.0);
            let alpha = a * a * (3.0 - 2.0 * a) * strength;
            if alpha <= 0.0 {
                continue;
            }
            let Some(p) = sample(&restored, u, v) else {
                continue;
            };
            let i = ((gy * target.width + gx) * 3) as usize;
            for (dst, &new) in target.data[i..i + 3].iter_mut().zip(&p) {
                let old = *dst as f32;
                *dst = crate::q8(old + (new - old) * alpha);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testutil::synthetic;

    #[test]
    fn similarity_fit_recovers_a_known_transform() {
        let truth = Similarity {
            a: 1.3,
            b: 0.4,
            tx: 20.0,
            ty: -7.0,
        };
        let src: Vec<[f32; 2]> = TEMPLATE.to_vec();
        let dst: Vec<[f32; 2]> = src
            .iter()
            .map(|p| {
                let (u, v) = truth.apply(p[0], p[1]);
                [u, v]
            })
            .collect();
        let fit = Similarity::fit(&src, &dst);
        assert!((fit.a - truth.a).abs() < 1e-3 && (fit.b - truth.b).abs() < 1e-3);
        assert!((fit.tx - truth.tx).abs() < 1e-2 && (fit.ty - truth.ty).abs() < 1e-2);
        let (x, y) = fit.invert(dst[2][0], dst[2][1]);
        assert!((x - src[2][0]).abs() < 1e-2 && (y - src[2][1]).abs() < 1e-2);
    }

    #[test]
    fn template_landmarks_align_to_identity() {
        let t = alignment(&TEMPLATE);
        assert!((t.a - 1.0).abs() < 1e-4 && t.b.abs() < 1e-4);
        assert!(t.tx.abs() < 1e-2 && t.ty.abs() < 1e-2);
    }

    #[test]
    fn canonical_orders_by_x() {
        let mut swapped = TEMPLATE;
        swapped.swap(0, 1);
        swapped.swap(3, 4);
        assert_eq!(canonical(&swapped), TEMPLATE);
    }

    #[test]
    fn crop_then_paste_at_full_strength_reproduces_the_face_region() {
        let img = synthetic(300, 300);
        // A face occupying the middle of the image, half the template's size.
        let lm: [[f32; 2]; 5] = TEMPLATE.map(|p| [p[0] * 0.5 + 20.0, p[1] * 0.5 + 25.0]);
        let crop = face_crop(&img, &lm);
        assert_eq!(crop.len(), 512 * 512 * 3);
        assert!(crop.iter().all(|v| (-1.0..=1.0).contains(v)));

        let mut target = img.clone();
        face_paste(&mut target, 1.0, &lm, &crop, 8.0, 1.0);
        // Deep inside the face square, the paste is the crop resampled back:
        // close to the original, not identical (two bilinear passes).
        let t = alignment(&lm);
        let (cx, cy) = t.invert(256.0, 256.0);
        let (cx, cy) = (cx.round() as u32, cy.round() as u32);
        let a = target.px(cx, cy);
        let b = img.px(cx, cy);
        for c in 0..3 {
            assert!((a[c] as i32 - b[c] as i32).abs() <= 12, "{a:?} vs {b:?}");
        }
        // Far outside the square, untouched.
        assert_eq!(target.px(2, 2), img.px(2, 2));
        assert_eq!(target.px(297, 297), img.px(297, 297));
    }

    #[test]
    fn paste_into_an_upscaled_target_lands_in_the_right_place() {
        let img = synthetic(100, 100);
        let lm: [[f32; 2]; 5] = TEMPLATE.map(|p| [p[0] * 0.15 + 10.0, p[1] * 0.15 + 12.0]);
        // A uniformly white "restored" face.
        let white = vec![1.0f32; 512 * 512 * 3];
        let mut target = resize(&img, 400, 400, Filter::Nearest);
        let before = target.clone();
        face_paste(&mut target, 4.0, &lm, &white, 4.0, 1.0);
        let t = alignment(&lm);
        let (cx, cy) = t.invert(256.0, 256.0);
        let p = target.px((cx * 4.0) as u32, (cy * 4.0) as u32);
        assert_eq!(p, [255, 255, 255]);
        // The corner of the image is outside the square.
        assert_eq!(target.px(0, 0), before.px(0, 0));
    }

    #[test]
    fn decode_reads_a_planted_detection() {
        // One cell at stride 32, row 3 col 4, high confidence.
        let n = 20 * 20;
        let mut cls = vec![0.0; n];
        let mut obj = vec![0.0; n];
        let mut bbox = vec![0.0; n * 4];
        let mut kps = vec![0.0; n * 10];
        let i = 3 * 20 + 4;
        cls[i] = 0.9;
        obj[i] = 0.9;
        bbox[i * 4] = 0.5;
        bbox[i * 4 + 1] = 0.5;
        bbox[i * 4 + 2] = (100.0f32 / 32.0).ln();
        bbox[i * 4 + 3] = (120.0f32 / 32.0).ln();
        for k in 0..5 {
            kps[i * 10 + k * 2] = k as f32 * 0.1;
            kps[i * 10 + k * 2 + 1] = 0.2;
        }
        let empty8 = (
            vec![0.0; 6400],
            vec![0.0; 6400],
            vec![0.0; 6400 * 4],
            vec![0.0; 6400 * 10],
        );
        let empty16 = (
            vec![0.0; 1600],
            vec![0.0; 1600],
            vec![0.0; 1600 * 4],
            vec![0.0; 1600 * 10],
        );
        let heads = [
            StrideHeads {
                stride: 8,
                cls: &empty8.0,
                obj: &empty8.1,
                bbox: &empty8.2,
                kps: &empty8.3,
            },
            StrideHeads {
                stride: 16,
                cls: &empty16.0,
                obj: &empty16.1,
                bbox: &empty16.2,
                kps: &empty16.3,
            },
            StrideHeads {
                stride: 32,
                cls: &cls,
                obj: &obj,
                bbox: &bbox,
                kps: &kps,
            },
        ];
        let faces = detect_decode(&heads, 0.5); // source was 1280 wide
        assert_eq!(faces.len(), 1);
        let f = &faces[0];
        assert!((f.score - 0.9).abs() < 1e-4);
        // centre (4.5*32, 3.5*32) = (144, 112) in the 640 frame → ×2 in source
        assert!((f.bbox[0] - (144.0 - 50.0) * 2.0).abs() < 1e-3);
        assert!((f.bbox[2] - 200.0).abs() < 1e-3);
        assert!((f.landmarks[1][0] - (4.1 * 32.0) * 2.0).abs() < 1e-3);
    }

    #[test]
    fn detect_input_is_bgr_letterboxed() {
        let mut img = Rgb::new(64, 32);
        for px in img.data.as_chunks_mut::<3>().0 {
            px.copy_from_slice(&[200, 100, 50]);
        }
        let x = detect_input(&img);
        let plane = 640 * 640;
        assert_eq!(x.len(), plane * 3);
        assert_eq!(x[0], 50.0); // B first
        assert_eq!(x[2 * plane], 200.0); // R last
                                         // Below the letterboxed 320 rows, zeros.
        assert_eq!(x[400 * 640], 0.0);
        assert!((detect_scale(64, 32) - 10.0).abs() < 1e-6);
    }
}
