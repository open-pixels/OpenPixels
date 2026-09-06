#!/usr/bin/env bash
# Puts every ONNX file the app serves into .vendor/models/, verifying the
# sha256 of each.
#
# Five of the nine are produced here rather than downloaded: Real-ESRGAN
# publishes PyTorch weights only, so scripts/export-models.py converts them
# (and bakes in the denoise blend, which the browser cannot do at runtime).
# That step needs torch, so it runs once and its outputs are what get
# checksummed — see MODELS.md for the provenance of every file.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
DEST="$ROOT/.vendor/models"
UPSTREAM="$ROOT/.vendor/upstream"
mkdir -p "$DEST" "$UPSTREAM"

sha() { shasum -a 256 "$1" | cut -d' ' -f1; }

# Files fetched directly, in the form the app ships. name|url|sha256
DIRECT=(
  "deoldify_artistic.onnx|https://huggingface.co/facefusion/models-3.0.0/resolve/main/deoldify_artistic.onnx|9ac296cf05fecbdb604f50211f632b722402bc1f9a96ee5a8987b01c0c3c688f"
  "u2netp.onnx|https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx|309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
  "face_detection_yunet_2023mar.onnx|https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx|8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
)

# Sources for the export step, which are not shipped as-is.
SOURCES=(
  "realesr-general-x4v3.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-x4v3.pth"
  "realesr-general-wdn-x4v3.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/realesr-general-wdn-x4v3.pth"
  "RealESRGAN_x4plus.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.1.0/RealESRGAN_x4plus.pth"
  "RealESRGAN_x4plus_anime_6B.pth|https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.2.4/RealESRGAN_x4plus_anime_6B.pth"
  "gfpgan_1.4.onnx|https://huggingface.co/facefusion/models-3.0.0/resolve/main/gfpgan_1.4.onnx"
)

# Everything the app expects to exist afterwards, with its pin. The five
# exported files are listed here too: export-models.py is deterministic, so
# a mismatch means the conversion changed and MODELS.md needs revisiting.
EXPECTED=(
  "realesr_general_x4v3.onnx|0e121299bf9b23a764d3f9e2120d0d0727d5ac5032e03a46cb78d28bcc7c6872"
  "realesr_general_x4v3_dn50.onnx|b345bc59c38dbb78d871b5adf9519c475fe243c198f70cc9d0b97a464715d50b"
  "realesr_general_wdn_x4v3.onnx|be536211515f088de05f1aa799a8079e92f49978b47aad6cec007f9fca62bb68"
  "realesrgan_x4plus.onnx|800a80063abcc8db53f6579407347ac2d53a9f5697dcc839cff38fbd806faf37"
  "realesrgan_x4plus_anime_6b.onnx|46c5fe739aa63319ad027112abfbee1d8bf6219a17ed36fccb5f454ad8c69011"
  "gfpgan_1.4_fp16.onnx|a94d1ae4353e9fee4f7dae2639bf9b3311188eab3d40b9ec8cc821e8aa42db3c"
  "deoldify_artistic.onnx|9ac296cf05fecbdb604f50211f632b722402bc1f9a96ee5a8987b01c0c3c688f"
  "u2netp.onnx|309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8"
  "face_detection_yunet_2023mar.onnx|8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
)

get() { # name url want dest
  local name="$1" url="$2" want="$3" dir="$4" path="$4/$1"
  if [ -f "$path" ] && { [ -z "$want" ] || [ "$(sha "$path")" = "$want" ]; }; then
    echo "  ok   $name (cached)"
    return
  fi
  echo "  get  $name"
  # .part until the checksum passes: an interrupted fetch must never leave a
  # truncated model that looks cached next time.
  curl -fL --progress-bar -o "$path.part" "$url"
  if [ -n "$want" ]; then
    local got; got="$(sha "$path.part")"
    if [ "$got" != "$want" ]; then
      rm -f "$path.part"
      echo "fetch-models.sh: checksum mismatch for $name" >&2
      echo "  expected $want" >&2
      echo "  got      $got" >&2
      exit 1
    fi
  fi
  mv "$path.part" "$path"
}

echo "Models shipped as downloaded:"
for e in "${DIRECT[@]}"; do
  IFS='|' read -r name url want <<<"$e"
  get "$name" "$url" "$want" "$DEST"
done

missing=0
for e in "${EXPECTED[@]}"; do
  IFS='|' read -r name want <<<"$e"
  [ -f "$DEST/$name" ] || missing=1
done

if [ "$missing" = 1 ]; then
  echo
  echo "Sources for the export step:"
  for e in "${SOURCES[@]}"; do
    IFS='|' read -r name url <<<"$e"
    get "$name" "$url" "" "$UPSTREAM"
  done
  echo
  echo "Converting to ONNX (needs torch, onnx, onnxruntime, onnxconverter-common):"
  python3 "$ROOT/scripts/export-models.py" --src "$UPSTREAM" --out "$DEST"
fi

echo
echo "Verifying every shipped model:"
fail=0
for e in "${EXPECTED[@]}"; do
  IFS='|' read -r name want <<<"$e"
  if [ ! -f "$DEST/$name" ]; then
    echo "  MISSING  $name" >&2
    fail=1
  elif [ "$(sha "$DEST/$name")" != "$want" ]; then
    echo "  MISMATCH $name" >&2
    echo "    expected $want  got $(sha "$DEST/$name")" >&2
    fail=1
  else
    echo "  ok   $name"
  fi
done
[ "$fail" = 0 ] || exit 1

echo
echo "Models in $DEST"
