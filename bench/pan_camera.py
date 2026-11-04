"""Makes two test videos from a calibrated static clip, for GEM-X's camera modes. CPU only.

<prefix>_undist.mp4: the full frame with the lens distortion removed, same size and intrinsics as the calibration.
<prefix>_pan.mp4: a 1280x720 virtual camera at the same focal length, turning about its centre to follow the person
(the tracked box from an earlier GEM-X run) with an operator's lag and a small handheld wobble in tilt and roll.
A turn about the camera centre is exactly a homography of the static view, so each virtual frame is drawn from the
source with no parallax error. A sliding crop would not do: the background estimator reads a pure shift as only
about half the turn. <prefix>_pan_rotations.npy holds the true world-to-camera rotations (world = the source
camera), shaped [T,3,3], for GEM-X's "provided" camera mode.

Run with GEM-X's venv:
  python pan_camera.py <source.mp4> <calibration.json> <camera name> <gem.pt> <out prefix>
"""

import json
import subprocess
import sys

import cv2
import numpy as np
import torch

source, calibration_file, camera_name, gem_file, prefix = sys.argv[1:6]
camera = next(c for c in json.load(open(calibration_file))["cameras"] if c["name"] == camera_name)
K = np.array(camera["K"], dtype=np.float64)
dist = np.array(camera["distCoef"], dtype=np.float64)
width, height = camera["resolution"]
boxes = torch.load(gem_file, map_location="cpu", weights_only=False)["conditions"]["bbx_xys"][0].numpy()
count = len(boxes)
FPS = 30000 / 1001
SIZE = (1280, 720)
focal = float(np.sqrt(K[0, 0] * K[1, 1]))
K_pan = np.array([[focal, 0, (SIZE[0] - 1) / 2], [0, focal, (SIZE[1] - 1) / 2], [0, 0, 1]])


def rot_x(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[1, 0, 0], [0, c, -s], [0, s, c]])


def rot_y(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, 0, s], [0, 1, 0], [-s, 0, c]])


def rot_z(a):
    c, s = np.cos(a), np.sin(a)
    return np.array([[c, -s, 0], [s, c, 0], [0, 0, 1]])


def source_map(view_to_source, K_view, size):
    """Distorted source pixel for every pixel of a pinhole view turned by view_to_source (OpenCV axes)."""
    u, v = np.meshgrid(np.arange(size[0]), np.arange(size[1]))
    pixels = np.stack([u, v, np.ones_like(u)], -1).reshape(-1, 3).astype(np.float64)
    rays = pixels @ np.linalg.inv(K_view).T @ view_to_source.T
    points, _ = cv2.projectPoints(rays, np.zeros(3), np.zeros(3), K, dist)
    return points.reshape(size[1], size[0], 2).astype(np.float32)


def border_inside(view_to_source, margin=2):
    """True when the view's edge pixels all land inside the source frame."""
    w, h = SIZE
    edge = [(x, y) for x in np.linspace(0, w - 1, 17) for y in (0, h - 1)] + [(x, y) for y in np.linspace(0, h - 1, 9) for x in (0, w - 1)]
    rays = np.array([[x, y, 1.0] for x, y in edge]) @ np.linalg.inv(K_pan).T @ view_to_source.T
    if (rays[:, 2] <= 0).any():
        return False
    points, _ = cv2.projectPoints(rays, np.zeros(3), np.zeros(3), K, dist)
    points = points.reshape(-1, 2)
    return bool((points[:, 0] >= margin).all() and (points[:, 0] <= width - 1 - margin).all() and (points[:, 1] >= margin).all() and (points[:, 1] <= height - 1 - margin).all())


# Where the person is, as yaw and pitch from the source camera, then an operator following with a lag.
centres = cv2.undistortPoints(boxes[:, None, :2].astype(np.float64), K, dist).reshape(-1, 2)
yaw_target, pitch_target = np.arctan(centres[:, 0]), np.arctan(centres[:, 1] / np.sqrt(1 + centres[:, 0] ** 2))
lag = 1 - np.exp(-1 / (0.35 * 30))
yaw, pitch = np.empty(count), np.empty(count)
yaw[0], pitch[0] = yaw_target[0], pitch_target[0]
for t in range(1, count):
    yaw[t] = yaw[t - 1] + lag * (yaw_target[t] - yaw[t - 1])
    pitch[t] = pitch[t - 1] + lag * (pitch_target[t] - pitch[t - 1])
time = np.arange(count) / 30
deg = np.pi / 180
yaw += 0.3 * deg * np.sin(2 * np.pi * 1.3 * time + 2)
pitch += 1.2 * deg * np.sin(2 * np.pi * 0.37 * time) + 0.3 * deg * np.sin(2 * np.pi * 2.1 * time + 1)
roll = 0.8 * deg * np.sin(2 * np.pi * 0.29 * time + 0.5) + 0.2 * deg * np.sin(2 * np.pi * 1.7 * time)

turns, shrunk = [], 0
for t in range(count):
    scale = 1.0
    while True:
        turn = rot_y(yaw[t] * scale) @ rot_x(-pitch[t] * scale) @ rot_z(roll[t])
        if border_inside(turn) or scale < 0.05:
            break
        scale *= 0.97
    shrunk += scale < 1
    turns.append(turn)
turns = np.array(turns)
np.save(f"{prefix}_pan_rotations.npy", np.transpose(turns, (0, 2, 1)).astype(np.float32))
angles = np.array([[np.arctan2(m[0, 2], m[2, 2]), np.arcsin(m[1, 2])] for m in turns]) / deg
print(f"pan: yaw {angles[:, 0].min():.1f} to {angles[:, 0].max():.1f} deg, pitch {angles[:, 1].min():.1f} to {angles[:, 1].max():.1f} deg, roll within {np.abs(roll).max() / deg:.1f}; {shrunk} of {count} frames pulled in to keep the view inside the source")
print("undist intrinsics", K.tolist())
print("pan intrinsics", K_pan.tolist())


def writer(path, size):
    return subprocess.Popen(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{size[0]}x{size[1]}", "-r", "30000/1001", "-i", "-", "-c:v", "libx264", "-crf", "14", "-preset", "medium", "-pix_fmt", "yuv420p", path],
        stdin=subprocess.PIPE,
    )


undist_map = source_map(np.eye(3), K, (width, height))
outputs = {"undist": writer(f"{prefix}_undist.mp4", (width, height)), "pan": writer(f"{prefix}_pan.mp4", SIZE)}
capture = cv2.VideoCapture(source)
for t in range(count):
    ok, frame = capture.read()
    if not ok:
        raise SystemExit(f"source ended at frame {t}, expected {count}")
    outputs["undist"].stdin.write(cv2.remap(frame, undist_map, None, cv2.INTER_LANCZOS4).tobytes())
    pan_map = source_map(turns[t], K_pan, SIZE)
    outputs["pan"].stdin.write(cv2.remap(frame, pan_map, None, cv2.INTER_LANCZOS4).tobytes())
for process in outputs.values():
    process.stdin.close()
    process.wait()
print("wrote", f"{prefix}_undist.mp4", f"{prefix}_pan.mp4", f"{prefix}_pan_rotations.npy")
