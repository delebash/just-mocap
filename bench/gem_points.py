"""Turns GEM-X body and EgoHand results into the 21 hand points that truth_hands.js scores. CPU only.
Run from the GEM-X folder with its venv: python gem_points.py <gem.pt> <ego.pt> <out.json>
"""

import json
import sys

import torch

from gem.motion.geometry import MotionGeometry

gem_file, ego_file, out_file = sys.argv[1:4]

# EgoHand's 25 joints follow SOMA's order: hand, thumb 1-3 + end, then four fingers 1-4 + end.
EGO_TO_21 = [0, 1, 2, 3, 4, 6, 7, 8, 9, 11, 12, 13, 14, 16, 17, 18, 19, 21, 22, 23, 24]


def body_to_21(side):
    """SOMA body names for one hand, as the 21 points. Finger bone 1 is the metacarpal, so fingers start at 2."""
    prefix = f"{side}Hand"
    points = [prefix]
    points += [f"{prefix}Thumb{i}" for i in (1, 2, 3)] + [f"{prefix}ThumbEnd"]
    for finger in ("Index", "Middle", "Ring", "Pinky"):
        points += [f"{prefix}{finger}{i}" for i in (2, 3, 4)] + [f"{prefix}{finger}End"]
    return points


gem = torch.load(gem_file, map_location="cpu", weights_only=False)
geometry = MotionGeometry(soma_assets="assets/soma", device="cpu", lod="low")
parameters = {k: v.float() for k, v in gem["pred_soma_params_incam"].items()}
joints = geometry(parameters)["joints"][0]
runtime = geometry.body_model.runtime
names = [n for n in runtime.rig_data["joint_names"] if "Twist" not in n and n != "Root"]
if len(names) != joints.shape[1]:
    raise SystemExit(f"expected {joints.shape[1]} joint names, got {len(names)}")
index = {name: i for i, name in enumerate(names)}

result = {"gem": {}, "gem2d": {}, "ego": {"left": [], "right": []}, "egoSmooth": {"left": [], "right": []}, "ego2d": {"left": [], "right": []}}
kp2d = gem["conditions"]["kp2d_native77"][0]
for key, side in (("left", "Left"), ("right", "Right")):
    ids = [index[n] for n in body_to_21(side)]
    result["gem"][key] = (joints[:, ids] * 100).tolist()
    result["gem2d"][key] = kp2d[:, ids, :2].tolist()

ego = torch.load(ego_file, map_location="cpu", weights_only=False)
for frame in ego["frames"]:
    seen = {}
    for instance in frame["instances"]:
        side = instance["side"]
        if side in seen and seen[side]["detection_score"] >= instance["detection_score"]:
            continue
        seen[side] = instance
    for side in ("left", "right"):
        instance = seen.get(side)
        if instance is None:
            for key in ("ego", "egoSmooth", "ego2d"):
                result[key][side].append(None)
            continue
        result["ego"][side].append((instance["joints_camera"][EGO_TO_21] * 100).tolist())
        smoothed = instance.get("smoothed") or instance
        result["egoSmooth"][side].append((smoothed["joints_camera"][EGO_TO_21] * 100).tolist())
        result["ego2d"][side].append(instance["keypoints_2d"][EGO_TO_21].tolist())

with open(out_file, "w") as handle:
    json.dump(result, handle)
print("gem frames", joints.shape[0], "ego left found", sum(p is not None for p in result["ego"]["left"]), "right", sum(p is not None for p in result["ego"]["right"]))
