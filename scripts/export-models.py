#!/usr/bin/env python3
"""
Turns the upstream Real-ESRGAN checkpoints into the ONNX graphs the web
app runs, and produces the fp16 halves of the two large face/colour models.

Why this exists rather than downloading someone's ONNX: the official
Real-ESRGAN release only ships PyTorch weights, and the browser needs the
graph in a form where (a) the height and width are dynamic so tiles of any
size go through one session, (b) the input and output names are known,
and (c) the "denoise strength" blend Real-ESRGAN performs at runtime by
interpolating two state dicts is baked in, because the browser cannot
interpolate weights inside an ONNX file.

The architectures below are transcribed from basicsr (BSD-3-Clause,
xinntao) so this script needs only torch + onnx, not basicsr's dependency
tree, which no longer installs cleanly against current torchvision.

Every export is checked against the PyTorch forward pass on a random
input before it is written; a mismatch above 1e-3 fails the run.

Usage:
    python3 scripts/export-models.py --src .vendor/upstream --out .vendor/models

Inputs expected in --src (see scripts/fetch-models.sh, which downloads and
checksums them):
    realesr-general-x4v3.pth, realesr-general-wdn-x4v3.pth,
    RealESRGAN_x4plus.pth, RealESRGAN_x4plus_anime_6B.pth,
    gfpgan_1.4.onnx, deoldify_artistic.onnx
"""

import argparse
import hashlib
import json
import shutil
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

# ------------------------------------------------------------ architectures


class SRVGGNetCompact(nn.Module):
    """realesr-general-x4v3 / -wdn-x4v3: 32 conv layers, PReLU, pixel shuffle."""

    def __init__(self, num_in_ch=3, num_out_ch=3, num_feat=64, num_conv=32, upscale=4):
        super().__init__()
        self.upscale = upscale
        self.body = nn.ModuleList()
        self.body.append(nn.Conv2d(num_in_ch, num_feat, 3, 1, 1))
        self.body.append(nn.PReLU(num_parameters=num_feat))
        for _ in range(num_conv):
            self.body.append(nn.Conv2d(num_feat, num_feat, 3, 1, 1))
            self.body.append(nn.PReLU(num_parameters=num_feat))
        self.body.append(nn.Conv2d(num_feat, num_out_ch * upscale * upscale, 3, 1, 1))
        self.upsampler = nn.PixelShuffle(upscale)

    def forward(self, x):
        out = x
        for layer in self.body:
            out = layer(out)
        out = self.upsampler(out)
        base = F.interpolate(x, scale_factor=self.upscale, mode="nearest")
        return out + base


class ResidualDenseBlock(nn.Module):
    def __init__(self, num_feat=64, num_grow_ch=32):
        super().__init__()
        self.conv1 = nn.Conv2d(num_feat, num_grow_ch, 3, 1, 1)
        self.conv2 = nn.Conv2d(num_feat + num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv3 = nn.Conv2d(num_feat + 2 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv4 = nn.Conv2d(num_feat + 3 * num_grow_ch, num_grow_ch, 3, 1, 1)
        self.conv5 = nn.Conv2d(num_feat + 4 * num_grow_ch, num_feat, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2)

    def forward(self, x):
        x1 = self.lrelu(self.conv1(x))
        x2 = self.lrelu(self.conv2(torch.cat((x, x1), 1)))
        x3 = self.lrelu(self.conv3(torch.cat((x, x1, x2), 1)))
        x4 = self.lrelu(self.conv4(torch.cat((x, x1, x2, x3), 1)))
        x5 = self.conv5(torch.cat((x, x1, x2, x3, x4), 1))
        return x5 * 0.2 + x


class RRDB(nn.Module):
    def __init__(self, num_feat, num_grow_ch=32):
        super().__init__()
        self.rdb1 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb2 = ResidualDenseBlock(num_feat, num_grow_ch)
        self.rdb3 = ResidualDenseBlock(num_feat, num_grow_ch)

    def forward(self, x):
        out = self.rdb3(self.rdb2(self.rdb1(x)))
        return out * 0.2 + x


class RRDBNet(nn.Module):
    """RealESRGAN_x4plus (23 blocks) and _anime_6B (6 blocks)."""

    def __init__(self, num_in_ch=3, num_out_ch=3, scale=4, num_feat=64, num_block=23, num_grow_ch=32):
        super().__init__()
        self.scale = scale
        if scale == 2:
            num_in_ch *= 4
        self.conv_first = nn.Conv2d(num_in_ch, num_feat, 3, 1, 1)
        self.body = nn.Sequential(*[RRDB(num_feat, num_grow_ch) for _ in range(num_block)])
        self.conv_body = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up1 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_up2 = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_hr = nn.Conv2d(num_feat, num_feat, 3, 1, 1)
        self.conv_last = nn.Conv2d(num_feat, num_out_ch, 3, 1, 1)
        self.lrelu = nn.LeakyReLU(negative_slope=0.2)

    def forward(self, x):
        feat = F.pixel_unshuffle(x, 2) if self.scale == 2 else x
        feat = self.conv_first(feat)
        feat = feat + self.conv_body(self.body(feat))
        feat = self.lrelu(self.conv_up1(F.interpolate(feat, scale_factor=2, mode="nearest")))
        feat = self.lrelu(self.conv_up2(F.interpolate(feat, scale_factor=2, mode="nearest")))
        return self.conv_last(self.lrelu(self.conv_hr(feat)))


# ------------------------------------------------------------------ helpers


def load_params(path: Path) -> dict:
    sd = torch.load(path, map_location="cpu", weights_only=True)
    for key in ("params_ema", "params"):
        if key in sd:
            return sd[key]
    return sd


def blend(a: dict, b: dict, wa: float) -> dict:
    """Real-ESRGAN's `dni`: linear interpolation of two state dicts."""
    return {k: a[k] * wa + b[k] * (1.0 - wa) for k in a}


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def export(model: nn.Module, out: Path, probe_hw=(64, 48)) -> None:
    """Export, verify against PyTorch, and only then put it in place.

    Same reasoning as `to_fp16`: a partial file that looks finished is worse
    than no file, because the next step checksums whatever it finds.
    """
    model.eval()
    partial = out.with_suffix(out.suffix + ".part")
    dummy = torch.rand(1, 3, *probe_hw)
    torch.onnx.export(
        model,
        dummy,
        str(partial),
        input_names=["input"],
        output_names=["output"],
        dynamic_axes={"input": {0: "batch", 2: "height", 3: "width"}, "output": {0: "batch", 2: "height", 3: "width"}},
        opset_version=17,
        do_constant_folding=True,
        dynamo=False,
    )
    check_parity(model, partial)
    partial.replace(out)


def check_parity(model: nn.Module, onnx_path: Path, hw=(40, 56), tol=1e-3) -> None:
    import onnxruntime as ort

    x = torch.rand(1, 3, *hw)
    with torch.no_grad():
        want = model(x).numpy()
    sess = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
    got = sess.run(None, {"input": x.numpy()})[0]
    diff = float(np.abs(want - got).max())
    if got.shape != want.shape or diff > tol:
        onnx_path.unlink(missing_ok=True)
        sys.exit(f"{onnx_path.name}: ONNX disagrees with PyTorch (shape {got.shape} vs {want.shape}, max diff {diff})")
    print(f"  ok   {onnx_path.name}  {onnx_path.stat().st_size / 1e6:.1f} MB  max diff {diff:.2e}")


def to_fp16(src: Path, dst: Path, input_name: str, hw: tuple[int, int], tol: float, block: tuple[str, ...] = ()) -> None:
    """Halve a model, then prove the half still loads and agrees with it.

    `block` names op types to leave in fp32. DeOldify needs Cast and Clip
    left alone: halved, onnxruntime refuses to load the graph with a type
    error naming a node hundreds of layers from the actual cause, so the
    failure gives no hint that these two ops are the problem.

    Written to a temporary file and only moved into place once it has been
    loaded and run. This conversion holds a large graph in memory twice and
    can be killed by the OS partway; what that leaves behind is a file of
    entirely plausible size that fails only when something tries to load it
    — and if it is sitting where the build expects it, the build will
    happily checksum it and ship it. This project shipped exactly that once.
    """
    import onnx
    import onnxruntime as ort
    from onnxconverter_common import float16

    model = onnx.load(str(src))
    half = float16.convert_float_to_float16(
        model,
        keep_io_types=True,
        disable_shape_infer=bool(block),
        op_block_list=float16.DEFAULT_OP_BLOCK_LIST + list(block) if block else None,
    )
    partial = dst.with_suffix(dst.suffix + ".part")
    onnx.save(half, str(partial))

    x = np.random.rand(1, 3, *hw).astype(np.float32) * 2 - 1
    a = ort.InferenceSession(str(src), providers=["CPUExecutionProvider"]).run(None, {input_name: x})[0]
    try:
        b = ort.InferenceSession(str(partial), providers=["CPUExecutionProvider"]).run(None, {input_name: x})[0]
    except Exception as e:
        partial.unlink(missing_ok=True)
        sys.exit(f"{dst.name}: the halved model does not load or run: {e}")
    diff = float(np.abs(a - b).mean())
    if diff > tol:
        partial.unlink(missing_ok=True)
        sys.exit(f"{dst.name}: fp16 drifts from fp32 by mean {diff:.4f} (limit {tol})")
    partial.replace(dst)
    print(f"  ok   {dst.name}  {dst.stat().st_size / 1e6:.1f} MB  mean diff vs fp32 {diff:.2e}")


# --------------------------------------------------------------------- main


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", type=Path, required=True, help="directory holding the upstream files")
    ap.add_argument("--out", type=Path, required=True, help="where the .onnx files go")
    ap.add_argument("--skip-fp16", action="store_true")
    ap.add_argument("--deoldify-fp16", action="store_true", help="halve DeOldify too; needs several GB free")
    args = ap.parse_args()
    src, out = args.src, args.out
    out.mkdir(parents=True, exist_ok=True)

    print("Real-ESRGAN general x4v3 (fast tier) — three denoise strengths")
    plain = load_params(src / "realesr-general-x4v3.pth")
    wdn = load_params(src / "realesr-general-wdn-x4v3.pth")
    for name, params in (
        ("realesr_general_x4v3.onnx", plain),
        ("realesr_general_x4v3_dn50.onnx", blend(wdn, plain, 0.5)),
        ("realesr_general_wdn_x4v3.onnx", wdn),
    ):
        m = SRVGGNetCompact()
        m.load_state_dict(params, strict=True)
        export(m, out / name)

    print("Real-ESRGAN x4plus (quality tier)")
    m = RRDBNet(num_block=23)
    m.load_state_dict(load_params(src / "RealESRGAN_x4plus.pth"), strict=True)
    export(m, out / "realesrgan_x4plus.onnx")

    print("Real-ESRGAN x4plus anime 6B")
    m = RRDBNet(num_block=6)
    m.load_state_dict(load_params(src / "RealESRGAN_x4plus_anime_6B.pth"), strict=True)
    export(m, out / "realesrgan_x4plus_anime_6b.onnx")

    if not args.skip_fp16:
        print("GFPGAN 1.4 → fp16")
        to_fp16(src / "gfpgan_1.4.onnx", out / "gfpgan_1.4_fp16.onnx", "input", (512, 512), tol=0.02)
    # DeOldify is *not* halved. It converts correctly with Cast and Clip
    # blocked (see docs/model-export.md), but the conversion needs several
    # gigabytes of memory, and a run that is killed partway leaves a file
    # that looks complete and fails only when onnxruntime tries to load it.
    # Shipping the 255 MB original is the better trade for the one model
    # most users never download. Pass --deoldify-fp16 if you have the
    # memory and want the smaller file.
    if args.deoldify_fp16:
        print("DeOldify artistic → fp16")
        # It takes 0-255 rather than [-1, 1], so the tolerance is on that
        # scale too.
        to_fp16(
            src / "deoldify_artistic.onnx",
            out / "deoldify_artistic_fp16.onnx",
            "input",
            (256, 256),
            tol=2.0,
            block=("Cast", "Clip"),
        )
    else:
        # DeOldify is the one model that is *not* converted here: it is shipped
        # exactly as downloaded, so fetch-models.sh puts it straight into the
        # output directory as a DIRECT entry and never fetches it into --src.
        #
        # This used to copy it from --src unconditionally, which worked on any
        # machine that happened to have a stale copy there and failed on every
        # clean checkout — CI included — with a bare FileNotFoundError three
        # frames deep in shutil. Both locations are checked now, and the error
        # says where the file is meant to come from.
        dst = out / "deoldify_artistic.onnx"
        upstream = src / "deoldify_artistic.onnx"
        if upstream.exists():
            print("DeOldify artistic — copying at full precision")
            shutil.copyfile(upstream, dst)
        elif dst.exists():
            print("DeOldify artistic — already in place, shipped as downloaded")
        else:
            raise SystemExit(
                f"deoldify_artistic.onnx is in neither {upstream} nor {dst}.\n"
                "It is downloaded rather than converted — run "
                "apps/web/scripts/fetch-models.sh, which fetches it as a DIRECT "
                "entry straight into the models directory."
            )

    manifest = {
        p.name: {"bytes": p.stat().st_size, "sha256": sha256(p)}
        for p in sorted(out.glob("*.onnx"))
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    print(f"wrote {out / 'manifest.json'}")
    for name, info in manifest.items():
        print(f"  {info['bytes']:>11}  {info['sha256']}  {name}")


if __name__ == "__main__":
    main()
