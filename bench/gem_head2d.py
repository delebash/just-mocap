"""Exports GEM-X's 2D head points per frame, so mp_face.py can crop the head the way a real pipeline would. CPU only.
Run from the GEM-X folder with its venv: python gem_head2d.py <gem.pt> <out.json>
"""

import json
import sys

import torch
from soma import SOMALayer, Unit

gem_file, out_file = sys.argv[1:3]
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
points = gem["conditions"]["kp2d_native77"][0]
names = [str(n) for n in SOMALayer("assets/soma", identity_model_type="soma", device="cpu", output_unit=Unit.METERS).public_joint_names][1:]
if len(names) != points.shape[1]:
    raise SystemExit(f"expected {points.shape[1]} names, got {len(names)}")
wanted = ("Neck2", "Head", "HeadEnd", "LeftEye", "RightEye", "Jaw")
result = {name: points[:, names.index(name)].tolist() for name in wanted}
with open(out_file, "w") as handle:
    json.dump(result, handle)
print("frames", points.shape[0], "values per point", points.shape[2])
