"""Compares bone positions read back by a DCC (bone_points.py) with the joints an export was made from.

The two can differ by units and axes, so one similarity transform (scale, rotation, shift) is fitted over every joint
and frame (Umeyama), and what is left is the import error. Printed in mm of the original skeleton.
Run: python check_import.py <stem>_joints.npz <points.json>
"""

import json
import sys

import numpy as np

joints_file, points_file = sys.argv[1:3]
source = np.load(joints_file)
names, truth = [str(n) for n in source["names"]], source["joints"]  # cm
points = json.load(open(points_file))
index = {n: i for i, n in enumerate(points["names"])}
missing = [n for n in names if n not in index]
if missing:
    raise SystemExit(f"bones missing after import: {missing}")
got = np.array(points["frames"])[:, [index[n] for n in names]]
if got.shape[0] != truth.shape[0]:
    raise SystemExit(f"frame count changed: {truth.shape[0]} written, {got.shape[0]} read")
x, y = got.reshape(-1, 3), truth.reshape(-1, 3)
mx, my = x.mean(0), y.mean(0)
u, s, vt = np.linalg.svd((y - my).T @ (x - mx))
d = np.sign(np.linalg.det(u @ vt))
R = u @ np.diag([1, 1, d]) @ vt
scale = (s * [1, 1, d]).sum() / ((x - mx) ** 2).sum()
fitted = (scale * (R @ (x - mx).T)).T + my
error = np.linalg.norm(fitted - y, axis=-1).reshape(truth.shape[:2]) * 10
worst = names[int(error.max(0).argmax())]
print(f"{points_file}: {len(names)} bones, {truth.shape[0]} frames, scale {scale:.4f}, error median {np.median(error):.3f} mm, max {error.max():.3f} mm (worst {worst})")
