"""Draws an exported take on its source video, so it can be judged by eye: the skeleton from <stem>_joints.npz (the
BVH's own joints, checked by export_mocap.py), both hands enlarged on the right, and some face curves from
<stem>_face.csv as bars. The world joints are put into the camera with the per-frame rigid move between GEM-X's world
and camera results (from the Hips), then projected with GEM-X's intrinsics.
Run from the GEM-X folder with its venv: python preview_export.py <joined.npz> <gem.pt> <stem> <video> [frames for the sheet]
Writes <stem>_preview.mp4 and <stem>_sheet.png.
"""

import csv
import sys

import cv2
import numpy as np
import torch

from gem.common.soma.body import SomaFixedGs1BodyAdapter, SomaRuntimeConfig

joined_file, gem_file, stem, video = sys.argv[1:5]
sheet_frames = [int(v) for v in sys.argv[5].split(",")] if len(sys.argv) > 5 else None
FACE = ["JawOpen", "EyeBlinkLeft", "EyeBlinkRight", "MouthSmileLeft", "MouthSmileRight", "BrowInnerUp", "BrowDownLeft", "EyeLookUpLeft"]

data = np.load(joined_file)
keys = ("global_orient", "body_pose", "identity_coeffs", "scale_params", "transl")
adapter = SomaFixedGs1BodyAdapter(SomaRuntimeConfig(data_root="assets/soma", device="cpu", lod="low"))
with torch.inference_mode():
    out = {s: adapter(**{k: torch.from_numpy(data[f"{s}_{k}"]).float()[None] for k in keys}, return_joints_only=True)["transforms"][0].double().numpy() for s in ("world", "incam")}
names = [str(n) for n in adapter.runtime.public_joint_names]
parents = adapter.runtime.output_joint_parent_ids.tolist()
hips = names.index("Hips")
Gw, Pw = out["world"][:, hips, :3, :3], out["world"][:, hips, :3, 3]
Gc, Pc = out["incam"][:, hips, :3, :3], out["incam"][:, hips, :3, 3]
R = Gc @ np.swapaxes(Gw, -1, -2)
t = Pc - np.einsum("tij,tj->ti", R, Pw)
rigid_gap = np.abs(np.einsum("tij,tkj->tki", R, out["world"][:, 1:, :3, 3]) + t[:, None] - out["incam"][:, 1:, :3, 3]).max() * 1000
print(f"world to camera as one rigid move per frame: largest joint gap {rigid_gap:.1f} mm")

exported = np.load(f"{stem}_joints.npz")
joint_names = [str(n) for n in exported["names"]]
camera = np.einsum("tij,tkj->tki", R, exported["joints"] / 100.0) + t[:, None]
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
K = gem["conditions"]["K_fullimg"][0].double().numpy()
pixels = np.einsum("tij,tkj->tki", K, camera)
pixels = pixels[..., :2] / pixels[..., 2:]
bones = [(joint_names.index(names[parents[names.index(n)]]), j) for j, n in enumerate(joint_names) if parents[names.index(n)] > 0]

face = None
try:
    with open(f"{stem}_face.csv") as handle:
        rows = list(csv.DictReader(handle))
    face = np.array([[float(r[k]) for k in FACE] for r in rows])
except FileNotFoundError:
    pass


def hand_ids(side):
    return [j for j, n in enumerate(joint_names) if n.startswith(f"{side}Hand")]


def colour(name):
    if name.startswith("LeftHand"):
        return (80, 220, 80)
    if name.startswith("RightHand"):
        return (60, 160, 255)
    return (255, 200, 60)


capture = cv2.VideoCapture(video)
frames_total = len(pixels)
writer = None
sheet = []
for f in range(frames_total):
    ok, frame = capture.read()
    if not ok:
        break
    drawn = frame.copy()
    for a, b in bones:
        thin = joint_names[b].startswith(("LeftHand", "RightHand")) and joint_names[b] not in ("LeftHand", "RightHand")
        p, q = tuple(int(round(v)) for v in pixels[f, a]), tuple(int(round(v)) for v in pixels[f, b])
        cv2.line(drawn, p, q, colour(joint_names[b]), 1 if thin else 3, cv2.LINE_AA)
    height, width = drawn.shape[:2]
    main = cv2.resize(drawn, (1280, round(1280 * height / width)))
    insets = []
    for side in ("Right", "Left"):  # the person's right hand is on the image's left for a facing camera
        ids = hand_ids(side)
        box = pixels[f, ids]
        centre = box.mean(0)
        size = max(48.0, 1.6 * np.ptp(box, axis=0).max())
        crop = cv2.getRectSubPix(drawn, (int(size), int(size)), tuple(float(v) for v in centre))
        crop = cv2.resize(crop, (main.shape[0] // 2, main.shape[0] // 2), interpolation=cv2.INTER_CUBIC)
        cv2.putText(crop, f"{side} hand", (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
        insets.append(crop)
    canvas = np.hstack([main, np.vstack(insets)])
    if face is not None:
        for i, name in enumerate(FACE):
            y = 20 + i * 22
            cv2.rectangle(canvas, (10, y - 12), (10 + int(150 * face[f, i]), y + 4), (255, 255, 255), -1)
            cv2.putText(canvas, f"{name} {face[f, i]:.2f}", (170, y + 2), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (255, 255, 255), 1)
    cv2.putText(canvas, f"frame {f}", (10, canvas.shape[0] - 12), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
    if writer is None:
        writer = cv2.VideoWriter(f"{stem}_preview.mp4", cv2.VideoWriter_fourcc(*"mp4v"), 30, (canvas.shape[1], canvas.shape[0]))
    writer.write(canvas)
    if sheet_frames and f in sheet_frames:
        sheet.append(canvas)
writer.release()
if sheet:
    half = [cv2.resize(c, (c.shape[1] // 2, c.shape[0] // 2)) for c in sheet]
    rows = [np.hstack(half[i : i + 2]) if i + 1 < len(half) else np.hstack([half[i], np.zeros_like(half[i])]) for i in range(0, len(half), 2)]
    cv2.imwrite(f"{stem}_sheet.png", np.vstack(rows))
print(f"preview: {f + 1} frames, {stem}_preview.mp4")
