#!/bin/sh
# Installs GEM-X and its files under E:, following docs/INSTALL.md and docs/PRETRAINED_MODELS.md. Touches no graphics card.
set -e
ROOT=/e/Dev/Web/just-mocap/gemx
mkdir -p "$ROOT/cache/pip" "$ROOT/cache/hf" "$ROOT/cache/tmp"
export PIP_CACHE_DIR="E:/Dev/Web/just-mocap/gemx/cache/pip"
export HF_HOME="E:/Dev/Web/just-mocap/gemx/cache/hf"
export TEMP="E:/Dev/Web/just-mocap/gemx/cache/tmp" TMP="E:/Dev/Web/just-mocap/gemx/cache/tmp"
export HF_HUB_DISABLE_TELEMETRY=1
cd "$ROOT"
[ -d GEM-X ] || git clone --depth 1 https://github.com/NVlabs/GEM-X.git
git -C GEM-X log -1 --format='GEM-X %h %ad' --date=short
[ -d .venv ] || python -m venv .venv
PY="$ROOT/.venv/Scripts/python.exe"
"$PY" -m pip install --quiet --upgrade pip
"$PY" -m pip install --quiet torch torchvision --index-url https://download.pytorch.org/whl/cu126
cd GEM-X
"$PY" -m pip install --quiet -e '.[video,hand]'
"$PY" -m pip install --quiet "py-soma-x==0.3.3" huggingface_hub
"$PY" -c "import torch, soma; print('torch', torch.__version__, torch.cuda.is_available(), 'soma', soma.__version__)"
HF="$ROOT/.venv/Scripts/hf.exe"
"$HF" download nvidia/GEM-X body_s240000.ckpt vitpose.pth body_video_native77.yaml motion_native77_e774_s292175.ckpt motion_stats_raw.npz motion_native77.yaml body_config.json --local-dir weights
"$HF" download nvidia/SOMA-X SOMA_neutral.npz SOMA_template_rig.usda SOMA_procedural_transforms.json --revision v0.3.3 --local-dir assets/soma
curl -sSL --fail -o weights/yolox_humanart.zip https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/yolox_x_8xb8-300e_humanart-a39d44ed.zip
"$PY" -c "
from pathlib import Path
from shutil import copyfileobj
from zipfile import ZipFile
with ZipFile('weights/yolox_humanart.zip') as archive:
    member = next(name for name in archive.namelist() if name.endswith('/end2end.onnx'))
    with archive.open(member) as source, Path('weights/yolox_humanart.onnx').open('wb') as target:
        copyfileobj(source, target)
"
"$HF" download nvidia/RT-DETR-Hand-Detector-v1 hand_detector.onnx --local-dir weights
"$HF" download nvidia/EgoHand-v1 egohand_s060000.ckpt --local-dir weights
ls -la weights assets/soma
command -v ffmpeg
echo SETUP-DONE
