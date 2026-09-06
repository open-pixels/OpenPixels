//! The browser-facing surface. Flat typed arrays in, flat typed arrays or
//! JSON out; nothing here does anything the native modules do not.

use crate::face::{self, Face, StrideHeads};
use crate::resize::{resize, Filter};
use crate::tile::{self, Merger, Tile, TilePlan};
use crate::{color, filters, matte, metrics, Rgb};
use wasm_bindgen::prelude::*;

#[wasm_bindgen(start)]
pub fn start() {
    console_error_panic_hook::set_once();
}

fn rgb(width: u32, height: u32, data: &[u8]) -> Rgb {
    Rgb::from_vec(width, height, data.to_vec())
}

// ------------------------------------------------------------ conversions
//
// Deliberately thin. RGBA-to-RGB and the CHW packing also exist in
// `apps/web/src/lib/image.js`, because the main thread has no wasm module —
// the worker owns it — and needs them to hand a decoded photo over. Exposing
// a second copy here that nothing calls would just be a second copy.

/// `filter`: 0 Lanczos3, 1 triangle, 2 nearest.
#[wasm_bindgen]
pub fn resize_rgb(
    width: u32,
    height: u32,
    data: &[u8],
    new_width: u32,
    new_height: u32,
    filter: u8,
) -> Vec<u8> {
    let f = match filter {
        1 => Filter::Triangle,
        2 => Filter::Nearest,
        _ => Filter::Lanczos3,
    };
    resize(&rgb(width, height, data), new_width, new_height, f).data
}

// ----------------------------------------------------------------- tiling

#[wasm_bindgen]
pub fn plan_tiles(width: u32, height: u32, tile: u32, overlap: u32) -> String {
    serde_json::to_string(&tile::plan(width, height, tile, overlap)).unwrap_or_default()
}

/// The tile at `(x, y, w, h)`, padded to `pad × pad` — the one shape every
/// run of a plan uses. See `tile`'s module docs for why it is constant.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn extract_tile(
    width: u32,
    height: u32,
    data: &[u8],
    x: u32,
    y: u32,
    w: u32,
    h: u32,
    pad: u32,
) -> Vec<f32> {
    tile::extract(&rgb(width, height, data), &Tile { x, y, w, h }, pad)
}

#[wasm_bindgen]
pub struct TileMerger {
    plan: TilePlan,
    scale: u32,
    inner: Merger,
}

#[wasm_bindgen]
impl TileMerger {
    #[wasm_bindgen(constructor)]
    pub fn new(plan_json: &str, scale: u32) -> Result<TileMerger, JsError> {
        let plan: TilePlan =
            serde_json::from_str(plan_json).map_err(|e| JsError::new(&e.to_string()))?;
        let inner = Merger::new(plan.width * scale, plan.height * scale);
        Ok(TileMerger { plan, scale, inner })
    }

    pub fn add(&mut self, index: usize, chw: &[f32]) -> Result<(), JsError> {
        let t = *self
            .plan
            .tiles
            .get(index)
            .ok_or_else(|| JsError::new("tile index out of range"))?;
        let stride = self.plan.pad.max(t.w).max(t.h) * self.scale;
        let need = (stride * stride * 3) as usize;
        if chw.len() < need {
            return Err(JsError::new(&format!(
                "tile {index}: model returned {} values, expected {need} for a {stride}x{stride} output",
                chw.len()
            )));
        }
        self.inner.add(&self.plan, &t, self.scale, chw);
        Ok(())
    }

    pub fn width(&self) -> u32 {
        self.inner.width()
    }
    pub fn height(&self) -> u32 {
        self.inner.height()
    }

    pub fn finish(&self) -> Vec<u8> {
        self.inner.finish().data
    }
}

// ---------------------------------------------------------------- metrics

#[wasm_bindgen]
pub fn quality_report(
    in_w: u32,
    in_h: u32,
    input: &[u8],
    out_w: u32,
    out_h: u32,
    output: &[u8],
) -> String {
    let r = metrics::report(&rgb(in_w, in_h, input), &rgb(out_w, out_h, output));
    serde_json::to_string(&r).unwrap_or_default()
}

// ---------------------------------------------------------------- filters

#[wasm_bindgen]
pub fn unsharp(
    width: u32,
    height: u32,
    data: &[u8],
    radius: f32,
    amount: f32,
    threshold: f32,
) -> Vec<u8> {
    filters::unsharp(&rgb(width, height, data), radius, amount, threshold).data
}

// ----------------------------------------------------------------- colour

#[wasm_bindgen]
pub fn mean_chroma(width: u32, height: u32, data: &[u8]) -> f32 {
    color::mean_chroma(&rgb(width, height, data))
}

#[wasm_bindgen]
pub fn deoldify_input(width: u32, height: u32, data: &[u8], size: u32) -> Vec<f32> {
    color::deoldify_input(&rgb(width, height, data), size)
}

#[wasm_bindgen]
pub fn colorize_merge(
    width: u32,
    height: u32,
    data: &[u8],
    chw: &[f32],
    size: u32,
    saturation: f32,
) -> Vec<u8> {
    color::colorize_merge(&rgb(width, height, data), chw, size, saturation).data
}

// ------------------------------------------------------------------ matte

#[wasm_bindgen]
pub fn u2net_input(width: u32, height: u32, data: &[u8]) -> Vec<f32> {
    matte::u2net_input(&rgb(width, height, data))
}

#[wasm_bindgen]
pub fn matte_from_output(d0: &[f32], width: u32, height: u32) -> Vec<u8> {
    matte::matte_from_output(d0, width, height)
}

#[wasm_bindgen]
pub fn replace_background(
    width: u32,
    height: u32,
    data: &[u8],
    matte: &[u8],
    r: u8,
    g: u8,
    b: u8,
) -> Vec<u8> {
    matte::replace_background(&rgb(width, height, data), matte, [r, g, b]).data
}

// ------------------------------------------------------------------ faces

#[wasm_bindgen]
pub fn face_detect_input(width: u32, height: u32, data: &[u8]) -> Vec<f32> {
    face::detect_input(&rgb(width, height, data))
}

#[wasm_bindgen]
pub fn face_detect_scale(width: u32, height: u32) -> f32 {
    face::detect_scale(width, height)
}

/// The twelve YuNet outputs, stride 8 then 16 then 32, `cls, obj, bbox, kps`
/// each. Returns the faces as JSON.
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn face_detect_decode(
    scale: f32,
    cls8: &[f32],
    obj8: &[f32],
    bbox8: &[f32],
    kps8: &[f32],
    cls16: &[f32],
    obj16: &[f32],
    bbox16: &[f32],
    kps16: &[f32],
    cls32: &[f32],
    obj32: &[f32],
    bbox32: &[f32],
    kps32: &[f32],
) -> String {
    let heads = [
        StrideHeads {
            stride: 8,
            cls: cls8,
            obj: obj8,
            bbox: bbox8,
            kps: kps8,
        },
        StrideHeads {
            stride: 16,
            cls: cls16,
            obj: obj16,
            bbox: bbox16,
            kps: kps16,
        },
        StrideHeads {
            stride: 32,
            cls: cls32,
            obj: obj32,
            bbox: bbox32,
            kps: kps32,
        },
    ];
    let faces: Vec<Face> = face::detect_decode(&heads, scale);
    serde_json::to_string(&faces).unwrap_or_else(|_| "[]".into())
}

fn landmarks(flat: &[f32]) -> Result<[[f32; 2]; 5], JsError> {
    if flat.len() != 10 {
        return Err(JsError::new("landmarks must be ten numbers"));
    }
    let mut lm = [[0.0; 2]; 5];
    for (k, p) in lm.iter_mut().enumerate() {
        *p = [flat[k * 2], flat[k * 2 + 1]];
    }
    Ok(lm)
}

#[wasm_bindgen]
pub fn face_crop(
    width: u32,
    height: u32,
    data: &[u8],
    landmarks_flat: &[f32],
) -> Result<Vec<f32>, JsError> {
    Ok(face::face_crop(
        &rgb(width, height, data),
        &landmarks(landmarks_flat)?,
    ))
}

/// Paste a restored face into `target` (returned as a new buffer).
#[allow(clippy::too_many_arguments)]
#[wasm_bindgen]
pub fn face_paste(
    width: u32,
    height: u32,
    target: &[u8],
    ratio: f32,
    landmarks_flat: &[f32],
    restored: &[f32],
    feather: f32,
    strength: f32,
) -> Result<Vec<u8>, JsError> {
    let mut img = rgb(width, height, target);
    face::face_paste(
        &mut img,
        ratio,
        &landmarks(landmarks_flat)?,
        restored,
        feather,
        strength,
    );
    Ok(img.data)
}
