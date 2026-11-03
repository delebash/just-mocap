"""Kimodo's MotionCorrection on an exported SOMA BVH, using GEM-X's own foot contacts. CPU only.

Kimodo (github.com/nv-tlabs/kimodo, MotionCorrection, Apache-2.0) plants each foot over its contact spans and then
smooths away the pops the planting causes. Its rig is the skeleton's neutral pose with identity rest rotations, which
is exactly how our BVH is written (offsets from the rest pose, each channel relative to it), so the BVH goes in as it
is. The rig, the SOMA settings (feet lifted 0.02 m in the rest pose, root margin 0.04) and the contact layout (left
heel, left toe, right heel, right toe) follow Kimodo's own kimodo/postprocess.py. Contacts are GEM-X's static
confidences for LeftFoot, LeftToeBase, RightFoot, RightToeBase (gem/motion/postprocess/contact.py, joints 69 70 74 75).

Built once into tmp/kimodo-mc (pip install --no-deps --target, see RESEARCH.md); the GEM-X venv is not changed.
Run: python kimodo_feet.py <exported.bvh> <gem.pt> <out stem> [contact threshold, default 0.5]
Writes <stem>.bvh (corrected) and <stem>_body.json (12 joints before and after, for truth_body.js: "global" is
after, "rawGlobal" before).
"""

import json
import sys
from pathlib import Path
from types import SimpleNamespace

import numpy as np
import torch
from scipy.spatial.transform import Rotation

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tmp" / "kimodo-mc"))
from motion_correction.motion_postprocess import correct_motion  # noqa: E402

bvh_file, gem_file, stem = sys.argv[1:4]
threshold = float(sys.argv[4]) if len(sys.argv) > 4 else 0.5

# --- read the BVH --------------------------------------------------------------------------------------------------
lines = Path(bvh_file).read_text().splitlines()
names, parents, offsets, channels, stack = [], [], [], [], []
row = 0
for row, line in enumerate(lines):
    parts = line.split()
    if not parts:
        continue
    if parts[0] == "MOTION":
        break
    if parts[0] in ("ROOT", "JOINT"):
        names.append(parts[1])
        parents.append(stack[-1] if stack else -1)
        offsets.append([0.0, 0.0, 0.0])
        channels.append([])
        stack.append(len(names) - 1)
    elif parts[0] == "End":
        stack.append(-2)
    elif parts[0] == "}":
        stack.pop()
    elif parts[0] == "OFFSET" and stack[-1] >= 0:
        offsets[stack[-1]] = [float(v) for v in parts[1:4]]
    elif parts[0] == "CHANNELS" and stack[-1] >= 0:
        channels[stack[-1]] = parts[2:]
frame_count = int(lines[row + 1].split()[1])
frame_time = lines[row + 2]
values = np.array([[float(v) for v in lines[row + 3 + f].split()] for f in range(frame_count)])
header = lines[: row + 1]
J, T = len(names), frame_count
offsets = np.array(offsets)

local = np.zeros((T, J, 3, 3))
hips = np.zeros((T, 3))
orders = []
cursor = 0
for j in range(J):
    rotation_channels = [c[0] for c in channels[j] if c.endswith("rotation")]
    orders.append("".join(rotation_channels))
    angles = []
    for c in channels[j]:
        if c.endswith("position"):
            hips[:, "XYZ".index(c[0])] = values[:, cursor]
        else:
            angles.append(values[:, cursor])
        cursor += 1
    local[:, j] = Rotation.from_euler(orders[j], np.stack(angles, 1), degrees=True).as_matrix()
if parents[0] != -1 or any(p >= i for i, p in enumerate(parents)):
    raise SystemExit("expected the root first and every parent before its children")


def forward(local_rotations, root_positions):
    rotations = np.zeros_like(local_rotations)
    positions = np.zeros(local_rotations.shape[:2] + (3,))
    for j, p in enumerate(parents):
        if p < 0:
            rotations[:, j] = local_rotations[:, j]
            positions[:, j] = root_positions
        else:
            rotations[:, j] = rotations[:, p] @ local_rotations[:, j]
            positions[:, j] = positions[:, p] + np.einsum("tab,b->ta", rotations[:, p], offsets[j])
    return positions


before = forward(local, hips)

# --- Kimodo's working rig, as kimodo/postprocess.py create_working_rig_from_skeleton builds it, in metres -----------
neutral = forward(np.broadcast_to(np.eye(3), (1, J, 3, 3)).copy(), np.zeros((1, 3)))[0] / 100
tags = {n: n for n in ("Hips", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot")}
rig = []
for j, name in enumerate(names):
    if parents[j] < 0:
        translation = (neutral[j] + np.array([0.0, -neutral[:, 1].min() + 0.02, 0.0])).tolist()
    else:
        translation = (neutral[j] - neutral[parents[j]]).tolist()
    rig.append(SimpleNamespace(name=name, parent=None if parents[j] < 0 else names[parents[j]],
                               t_pose_translation=translation, t_pose_rotation=[0.0, 0.0, 0.0, 1.0],
                               retarget_tag=tags.get(name)))

# --- GEM-X's contacts -------------------------------------------------------------------------------------------------
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
logits = torch.as_tensor(gem["static_conf_logits"]).float()
if logits.shape[1] != T:
    raise SystemExit(f"GEM-X has {logits.shape[1]} frames, the BVH {T}")
contacts = logits.sigmoid()[:, :, :4].clone()  # LeftFoot, LeftToeBase, RightFoot, RightToeBase

quaternions = Rotation.from_matrix(local.reshape(-1, 3, 3)).as_quat().reshape(T, J, 4)  # x, y, z, w
wxyz = torch.from_numpy(np.concatenate([quaternions[..., 3:], quaternions[..., :3]], -1)).float()[None]
root = torch.from_numpy(hips / 100).float()[None]
target_rotations = torch.zeros(1, T, J, 4)
target_rotations[..., 0] = 1.0
masks = {k: torch.zeros(T) for k in ("Root", "FullBody", "LeftHand", "RightHand", "LeftFoot", "RightFoot")}
correct_motion(root, wxyz, contacts, torch.zeros(1, T, 3), target_rotations, masks, threshold, 0.04, rig)

q = wxyz[0].double().numpy()
corrected_local = Rotation.from_quat(np.concatenate([q[..., 1:], q[..., :1]], -1).reshape(-1, 4)).as_matrix().reshape(T, J, 3, 3)
corrected_hips = root[0].double().numpy() * 100
after = forward(corrected_local, corrected_hips)

# --- write the corrected BVH with the same header and channel layout ------------------------------------------------
rows = []
for t in range(T):
    out = []
    for j in range(J):
        angles = iter(Rotation.from_matrix(corrected_local[t, j]).as_euler(orders[j], degrees=True))
        for c in channels[j]:
            out.append(corrected_hips[t, "XYZ".index(c[0])] if c.endswith("position") else next(angles))
    rows.append(" ".join(f"{v:.6f}" for v in out))
Path(f"{stem}.bvh").write_text("\n".join(header + [f"Frames: {T}", frame_time] + rows) + "\n")

limbs = [names.index(f"{side}{limb}") for side in ("Left", "Right") for limb in ("Arm", "ForeArm", "Hand", "Leg", "Shin", "Foot")]
Path(f"{stem}_body.json").write_text(json.dumps({"global": after[:, limbs].tolist(), "rawGlobal": before[:, limbs].tolist(), "incam": before[:, limbs].tolist()}))

moved = np.linalg.norm(after - before, axis=-1)
feet = [names.index(n) for n in ("LeftFoot", "LeftToeBase", "RightFoot", "RightToeBase")]
print(f"frames {T}, joints {J}, contact frames above {threshold}: " + ", ".join(f"{n} {int((contacts[0, :, i] > threshold).sum())}" for i, n in enumerate(("LFoot", "LToe", "RFoot", "RToe"))))
print(f"moved by the correction, mm: all joints median {np.median(moved) * 10:.1f} max {moved.max() * 10:.1f}; feet median {np.median(moved[:, feet]) * 10:.1f} max {moved[:, feet].max() * 10:.1f}")
