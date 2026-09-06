# Exporting the models

Five of the nine ONNX files are produced here rather than downloaded, by
`scripts/export-models.py`. This note is why, and what to watch.

## Why not just download an ONNX

The official Real-ESRGAN release ships PyTorch weights only, and the browser
needs three things a random third-party conversion will not reliably give:

1. **Dynamic height and width**, so every tile goes through one session.
2. **Known input and output names**, which the pipeline uses directly.
3. **The denoise blend baked in.** Real-ESRGAN's `--denoise_strength`
   linearly interpolates two state dicts *before* inference. A browser
   cannot interpolate weights inside an ONNX graph, so the middle setting is
   exported as its own file. Three 4.9 MB files is a better trade than one
   file plus a weight-blending implementation to verify against upstream.

The architectures in the script are transcribed from basicsr rather than
imported, because basicsr's dependency tree no longer installs cleanly
against current torchvision, and this needs only `torch` and `onnx`.

## The checks

Every export is run against the PyTorch forward pass on random input before
it is written, and a maximum absolute difference above `1e-3` fails the run.
Observed differences are around `1e-6`.

Every fp16 conversion is likewise run against its fp32 original and refuses
to be written if it drifts.

## The one non-obvious failure, and why DeOldify ships at full precision

DeOldify will not convert to fp16 with the default settings. It writes a
file, and loading it fails with:

```
Type Error: Type (tensor(float16)) of output arg (onnx::Clip_940) of node
(Cast_525) does not match expected type (tensor(float)).
```

The named node is hundreds of layers from the cause and the message gives no
hint which operator type to look at. The fix is to leave `Cast` and `Clip`
in fp32 and skip shape inference:

```python
float16.convert_float_to_float16(
    model, keep_io_types=True, disable_shape_infer=True,
    op_block_list=float16.DEFAULT_OP_BLOCK_LIST + ["Cast", "Clip"])
```

That works. It is still not the default, because the conversion holds the
873 MB source graph and both precisions in memory at once and wants several
gigabytes free — and when the OS kills it partway, what is left on disk is a
**file of plausible size that fails only when onnxruntime tries to load it**.
That happened here, and the broken artifact was checksummed into `MODELS.md`
before anything tried to run it. A build step whose failure mode is a
convincing forgery is not worth 128 MB on the one model most users never
download.

So `export-models.py` copies DeOldify across at full precision. Pass
`--deoldify-fp16` to halve it, on a machine with the memory, and verify it
loads before trusting the output. GFPGAN halves without any of this.

## Re-running

```sh
python3 -m venv venv && ./venv/bin/pip install torch onnx onnxruntime onnxconverter-common
./venv/bin/python scripts/export-models.py --src .vendor/upstream --out .vendor/models
```

The conversion is deterministic, so the checksums in `MODELS.md` and
`apps/web/scripts/fetch-models.sh` should reproduce. If they do not, the
conversion changed and both files need revisiting — `fetch-models.sh` will
fail loudly rather than shipping something unpinned.
