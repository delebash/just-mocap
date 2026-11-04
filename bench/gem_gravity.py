"""GEM-X's error in 'up', against Panoptic's calibrated camera: world up seen from the camera, true against GEM-X's.
GEM-X's world-to-camera rotation per frame is the root's camera orientation times its world orientation transposed.
Also the torso's lean from vertical, mean over the clip, in GEM-X's world and in the measured data.
Run from the GEM-X folder with its venv: python gem_gravity.py <calibration.json> <camera> <gem.pt> <gembody.json> <truth dir> <start>
"""

import json
import sys

import numpy as np
import torch
from scipy.spatial.transform import Rotation

calibration, camera_name, gem_file, body_file, truth_dir, start = sys.argv[1:7]
camera = next(c for c in json.load(open(calibration))["cameras"] if c["name"] == camera_name)
R_true = np.array(camera["R"])  # Panoptic world (y down) to camera
up_true = R_true @ np.array([0.0, -1.0, 0.0])
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
incam = Rotation.from_rotvec(gem["pred_soma_params_incam"]["global_orient"][0].double().numpy()).as_matrix()
world = Rotation.from_rotvec(gem["pred_soma_params_global"]["global_orient"][0].double().numpy()).as_matrix()
R_gem = incam @ np.swapaxes(world, -1, -2)  # GEM-X world (y up) to camera, per frame
up_gem = R_gem @ np.array([0.0, 1.0, 0.0])
angle = np.degrees(np.arccos(np.clip(up_gem @ up_true, -1, 1)))
# Split into the camera's pitch (about its x axis) and roll (about its z axis).
pitch = np.degrees(np.arctan2(up_gem[:, 2], -up_gem[:, 1])) - np.degrees(np.arctan2(up_true[2], -up_true[1]))
roll = np.degrees(np.arctan2(up_gem[:, 0], -up_gem[:, 1])) - np.degrees(np.arctan2(up_true[0], -up_true[1]))
print(f"up error: mean {angle.mean():.2f} deg (frames {angle.min():.2f}-{angle.max():.2f}); camera pitch {pitch.mean():+.2f}, roll {roll.mean():+.2f}")

body = json.load(open(body_file))["global"]  # 12 joints, cm, y up: shoulders 0 and 6, hips (Leg) 3 and 9
lean = []
for frame in body:
    f = np.array(frame)
    torso = (f[0] + f[6]) / 2 - (f[3] + f[9]) / 2
    lean.append(np.degrees(np.arccos(torso[1] / np.linalg.norm(torso))))
truth_lean = []
for t in range(300):
    data = json.load(open(f"{truth_dir}/hdPose3d_stage1_coco19/body3DScene_{int(start) + t:08d}.json"))
    if len(data.get("bodies", [])) != 1:
        continue
    j = np.array(data["bodies"][0]["joints19"]).reshape(-1, 4)[:, :3]
    torso = (j[3] + j[9]) / 2 - (j[6] + j[12]) / 2  # coco19: shoulders 3, 9; hips 6, 12
    truth_lean.append(np.degrees(np.arccos(-torso[1] / np.linalg.norm(torso))))
print(f"torso lean from vertical: GEM-X {np.mean(lean):.2f} deg, measured {np.mean(truth_lean):.2f} deg")
