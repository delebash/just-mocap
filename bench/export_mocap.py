"""Exports one joined take (join_fingers.py's .npz) as files other tools open.

BVH: GEM-X's 77 public SOMA joints with SAM 3D Body's fingers, Hips as root, centimetres, Y up, ZXY channels. The rest
pose is this person's SOMA reference pose (every rotation zero), offsets are world-aligned, and each channel is the joint's
rotation relative to that rest pose, so frame values of zero give the reference pose. One body shape for the clip: GEM-X's
own SOMA adapter takes the clip's mean when it is given a sequence, and the adapter itself poses the skeleton here.

Face, when a face result is given: MediaPipe's blendshapes from mp_face.py, gaps up to half a second filled, then a
zero-phase low-pass (10 Hz, blinks 15 Hz, the settings video2mocap uses), written in Live Link Face's CSV layout. Its
head and eye angle columns stay zero: the body file carries the head. TongueOut stays zero: MediaPipe has no tongue.

Printed checks: the written BVH read back and posed, against the SOMA layer's own joints for the same shape (should be
about 0 mm), and against GEM-X's joints with a shape per frame, as scored elsewhere (the cost of one shape).
Run from the GEM-X folder with its venv: python export_mocap.py <joined.npz> <out stem> [mp_face.json]
Writes <stem>.bvh, <stem>_joints.npz (the posed joints, for checking imports), and <stem>_face.csv.
"""

import json
import sys

import numpy as np
import torch
from scipy.signal import butter, filtfilt
from scipy.spatial.transform import Rotation

from gem.common.soma.body import SomaFixedGs1BodyAdapter, SomaRuntimeConfig
from gem.motion.geometry import MotionGeometry

joined_file, stem = sys.argv[1:3]
face_file = sys.argv[3] if len(sys.argv) > 3 else None
ORDER = "ZXY"
CM = 100.0

data = np.load(joined_file)
fps = float(data["fps"])
keys = ("global_orient", "body_pose", "identity_coeffs", "scale_params", "transl")
world = {k: torch.from_numpy(data[f"world_{k}"]).float()[None] for k in keys}
length = world["transl"].shape[1]

# --- Pose the clip and the rest pose with the same mean shape, through GEM-X's own adapter.
adapter = SomaFixedGs1BodyAdapter(SomaRuntimeConfig(data_root="assets/soma", device="cpu", lod="low"))
with torch.inference_mode():
    posed = adapter(**world, return_joints_only=True)
    rest = adapter(
        **{**world, "global_orient": torch.zeros_like(world["global_orient"]), "body_pose": torch.zeros_like(world["body_pose"]), "transl": torch.zeros_like(world["transl"])},
        return_joints_only=True,
    )
runtime = adapter.runtime
names = [str(n) for n in runtime.public_joint_names]
parents = runtime.output_joint_parent_ids.tolist()
G = posed["transforms"][0, :, :, :3, :3].double().numpy()  # (T, 78, 3, 3) world rotations, Root first
P = posed["transforms"][0, :, :, :3, 3].double().numpy()
O = rest["transforms"][0, 0, :, :3, :3].double().numpy()  # rest world rotations
P0 = rest["transforms"][0, 0, :, :3, 3].double().numpy()
gap = np.abs(P[:, 1:] - posed["joints"][0].double().numpy()).max() * 1000
if gap > 0.01:
    raise SystemExit(f"the adapter's transforms and joints disagree by {gap:.3f} mm")
up = (P[:, names.index("Head")] - P[:, names.index("Hips")]).mean(0)
if np.argmax(np.abs(up)) != 1 or up[1] < 0:
    raise SystemExit(f"GEM-X's world is not Y up here: hips to head {up}")

# --- Channels: world rotation relative to rest, W = G O^T; local = W_parent^T W.
W = G @ np.swapaxes(O, -1, -2)[None]
joints = list(range(1, len(names)))  # drop the virtual Root, Hips becomes the root
bvh_parent = {j: (parents[j] if parents[j] != 0 else -1) for j in joints}
children = {j: [c for c in joints if bvh_parent[c] == j] for j in joints}
local = {}
for j in joints:
    p = bvh_parent[j]
    local[j] = W[:, j] if p < 0 else np.swapaxes(W[:, p], -1, -2) @ W[:, j]
offset = {j: np.zeros(3) if bvh_parent[j] < 0 else (P0[j] - P0[bvh_parent[j]]) * CM for j in joints}

order = []


def visit(j):
    order.append(j)
    for c in children[j]:
        visit(c)


roots = [j for j in joints if bvh_parent[j] < 0]
if roots != [names.index("Hips")]:
    raise SystemExit(f"expected Hips as the only root, got {[names[j] for j in roots]}")
visit(roots[0])
lines = ["HIERARCHY"]
channels = " ".join(f"{a}rotation" for a in ORDER)


def emit(j, depth):
    pad = "  " * depth
    lines.append(f"{pad}{'ROOT' if bvh_parent[j] < 0 else 'JOINT'} {names[j]}")
    lines.append(f"{pad}{{")
    lines.append(f"{pad}  OFFSET {offset[j][0]:.6f} {offset[j][1]:.6f} {offset[j][2]:.6f}")
    lines.append(f"{pad}  CHANNELS {'6 Xposition Yposition Zposition ' if bvh_parent[j] < 0 else '3 '}{channels}")
    for c in children[j]:
        emit(c, depth + 1)
    if not children[j]:
        lines.extend([f"{pad}  End Site", f"{pad}  {{", f"{pad}    OFFSET 0.000000 0.000000 0.000000", f"{pad}  }}"])
    lines.append(f"{pad}}}")


emit(roots[0], 0)
euler = {j: np.degrees(np.unwrap(np.radians(Rotation.from_matrix(local[j]).as_euler(ORDER, degrees=True)), axis=0)) for j in order}
root_position = P[:, roots[0]] * CM
lines.extend(["MOTION", f"Frames: {length}", f"Frame Time: {1.0 / fps:.8f}"])
for t in range(length):
    values = [*root_position[t], *np.concatenate([euler[j][t] for j in order])]
    lines.append(" ".join(f"{v:.6f}" for v in values))
with open(f"{stem}.bvh", "w", encoding="utf-8", newline="\n") as handle:
    handle.write("\n".join(lines) + "\n")
np.savez_compressed(f"{stem}_joints.npz", names=np.array([names[j] for j in joints]), joints=P[:, joints] * CM)

# --- Check: read the BVH back and pose it.
text = open(f"{stem}.bvh", encoding="utf-8").read().split()
read_names, read_parents, read_offsets, stack, pending = [], [], [], [], False
i = 0
while text[i] != "MOTION":
    token = text[i]
    if token in ("ROOT", "JOINT"):
        read_names.append(text[i + 1])
        read_parents.append(stack[-1] if stack else -1)
        read_offsets.append(np.zeros(3))
        i += 2
    elif token == "End":
        pending, i = True, i + 2
    elif token == "{":
        stack.append(-2 if pending else len(read_names) - 1)
        pending, i = False, i + 1
    elif token == "}":
        stack.pop()
        i += 1
    elif token == "OFFSET":
        if stack[-1] >= 0:
            read_offsets[stack[-1]] = np.array(text[i + 1 : i + 4], float)
        i += 4
    else:
        i += 1
values = np.array(text[i + 6 :], float).reshape(length, -1)
rotations = Rotation.from_euler(ORDER, values[:, 3:].reshape(length, -1, 3).reshape(-1, 3), degrees=True).as_matrix().reshape(length, -1, 3, 3)
world_rot, world_pos = [None] * len(read_names), [None] * len(read_names)
for k, p in enumerate(read_parents):
    if p < 0:
        world_rot[k], world_pos[k] = rotations[:, k], values[:, :3] + read_offsets[k]
    else:
        world_rot[k] = world_rot[p] @ rotations[:, k]
        world_pos[k] = world_pos[p] + np.einsum("tij,j->ti", world_rot[p], read_offsets[k])
read_back = np.stack(world_pos, axis=1)
truth = P[:, [names.index(n) for n in read_names]] * CM
error = np.linalg.norm(read_back - truth, axis=-1) * 10
geometry = MotionGeometry(soma_assets="assets/soma", device="cpu", lod="low")
per_frame = geometry({k: v for k, v in world.items()})["joints"][0].double().numpy() * CM
shape_cost = np.linalg.norm(read_back - per_frame[:, [names.index(n) - 1 for n in read_names]], axis=-1) * 10
print(f"BVH: {len(read_names)} joints, {length} frames at {fps:g} fps; read back against the posed skeleton: max {error.max():.3f} mm")
print(f"one shape for the clip against GEM-X's shape per frame: median {np.median(shape_cost):.1f} mm, max {shape_cost.max():.1f} mm")

# --- Face curves in Live Link Face's CSV layout (header as a real recording has it).
LIVE_LINK_FACE = (
    "Timecode,BlendShapeCount,EyeBlinkLeft,EyeLookDownLeft,EyeLookInLeft,EyeLookOutLeft,EyeLookUpLeft,EyeSquintLeft,EyeWideLeft,"
    "EyeBlinkRight,EyeLookDownRight,EyeLookInRight,EyeLookOutRight,EyeLookUpRight,EyeSquintRight,EyeWideRight,JawForward,JawRight,"
    "JawLeft,JawOpen,MouthClose,MouthFunnel,MouthPucker,MouthRight,MouthLeft,MouthSmileLeft,MouthSmileRight,MouthFrownLeft,"
    "MouthFrownRight,MouthDimpleLeft,MouthDimpleRight,MouthStretchLeft,MouthStretchRight,MouthRollLower,MouthRollUpper,"
    "MouthShrugLower,MouthShrugUpper,MouthPressLeft,MouthPressRight,MouthLowerDownLeft,MouthLowerDownRight,MouthUpperUpLeft,"
    "MouthUpperUpRight,BrowDownLeft,BrowDownRight,BrowInnerUp,BrowOuterUpLeft,BrowOuterUpRight,CheekPuff,CheekSquintLeft,"
    "CheekSquintRight,NoseSneerLeft,NoseSneerRight,TongueOut,HeadYaw,HeadPitch,HeadRoll,LeftEyeYaw,LeftEyePitch,LeftEyeRoll,"
    "RightEyeYaw,RightEyePitch,RightEyeRoll"
).split(",")
if face_file:
    face = json.load(open(face_file))["frames"][:length]
    shapes = LIVE_LINK_FACE[2:-9]
    curves = np.full((length, len(shapes)), np.nan)
    for t, frame in enumerate(face):
        if "shapes" in frame:
            lookup = {k[0].upper() + k[1:]: v for k, v in frame["shapes"].items()}
            curves[t] = [lookup.get(name, 0.0) for name in shapes]
    found = ~np.isnan(curves[:, 0])
    seen = np.flatnonzero(found)
    for a, b in zip(seen[:-1], seen[1:]):
        if 1 < b - a <= round(0.5 * fps) + 1:
            w = ((np.arange(a + 1, b) - a) / (b - a))[:, None]
            curves[a + 1 : b] = curves[a] + (curves[b] - curves[a]) * w
    filled = ~np.isnan(curves[:, 0])
    blink = np.array(["Blink" in n for n in shapes])
    edges = np.flatnonzero(np.diff(np.concatenate([[0], filled.astype(int), [0]])))
    for start, stop in zip(edges[::2], edges[1::2]):
        if stop - start > 12:
            for cutoff, columns in ((10.0, ~blink), (15.0, blink)):
                b, a = butter(2, min(cutoff / (fps / 2), 0.99))
                curves[start:stop, columns] = filtfilt(b, a, curves[start:stop, columns], axis=0)
    curves = np.clip(np.nan_to_num(curves, nan=0.0), 0, 1)
    whole = round(fps)
    with open(f"{stem}_face.csv", "w", encoding="utf-8", newline="\n") as handle:
        handle.write(",".join(LIVE_LINK_FACE) + "\n")
        for t in range(length):
            seconds, frame = divmod(t, whole)
            code = f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}:{frame:02d}.000"
            handle.write(",".join([code, "61", *(f"{v:.6f}" for v in curves[t]), *(["0"] * 9)]) + "\n")
    print(f"face: found in {found.sum()} of {length} frames, {filled.sum()} after filling gaps; the rest are neutral")
