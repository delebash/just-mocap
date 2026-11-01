"""Exports GEM-X's 12 main body joints, in centimetres, for truth_body.js. CPU only.
Run from the GEM-X folder with its venv: python gem_body.py <gem.pt> <out.json>
"""

import json
import sys

import torch

from gem.motion.geometry import MotionGeometry

gem_file, out_file = sys.argv[1:3]
SIDES = ("Left", "Right")
LIMBS = ("Arm", "ForeArm", "Hand", "Leg", "Shin", "Foot")

gem = torch.load(gem_file, map_location="cpu", weights_only=False)
geometry = MotionGeometry(soma_assets="assets/soma", device="cpu", lod="low")
runtime = None


def joints_of(parameters):
    global runtime
    joints = geometry({k: v.float() for k, v in parameters.items()})["joints"][0]
    runtime = geometry.body_model.runtime
    names = [n for n in runtime.rig_data["joint_names"] if "Twist" not in n and n != "Root"]
    ids = [names.index(f"{side}{limb}") for side in SIDES for limb in LIMBS]
    return (joints[:, ids] * 100).tolist()


raw = gem.get("raw_predictions", {})
print("raw_predictions keys", list(raw.keys()))
result = {"global": joints_of(gem["pred_soma_params_global"]), "incam": joints_of(gem["pred_soma_params_incam"])}
for key, name in (("pred_soma_params_global", "rawGlobal"), ("pred_soma_params_incam", "rawIncam")):
    if key in raw:
        result[name] = joints_of(raw[key])
with open(out_file, "w") as handle:
    json.dump(result, handle)
print({k: len(v) for k, v in result.items()})
