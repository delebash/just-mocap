"""MediaPipe Face Landmarker, VIDEO mode, on a folder of frames (Multiface's PNGs). With a shrink factor below 1 each
frame is shrunk and enlarged back first, so the face carries only as many pixels as it would in a wider shot; this is
what a full-body pipeline's head crop sees. Points are written in the original frame's pixels.
Run with JustStage's tool environment: .dev/venv-tools/Scripts/python mp_face_frames.py <frames dir> <face_landmarker.task> <out.json> [shrink] [fps]
"""

import json
import os
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

folder, model, out = sys.argv[1:4]
shrink = float(sys.argv[4]) if len(sys.argv) > 4 else 1.0
fps = float(sys.argv[5]) if len(sys.argv) > 5 else 10.0
names = sorted(n for n in os.listdir(folder) if n.endswith(".png"))
options = vision.FaceLandmarkerOptions(
    base_options=mp_tasks.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.VIDEO,
    num_faces=1,
    output_face_blendshapes=True,
)
frames = []
with vision.FaceLandmarker.create_from_options(options) as detector:
    for index, name in enumerate(names):
        image = cv2.imread(os.path.join(folder, name))
        height, width = image.shape[:2]
        if shrink < 1:
            small = cv2.resize(image, (max(1, round(width * shrink)), max(1, round(height * shrink))), interpolation=cv2.INTER_AREA)
            image = cv2.resize(small, (width, height), interpolation=cv2.INTER_CUBIC)
        result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(image, cv2.COLOR_BGR2RGB)), int(index * 1000 / fps))
        entry = {"name": name}
        if result.face_landmarks:
            entry["points"] = [[p.x * width, p.y * height] for p in result.face_landmarks[0]]
            entry["shapes"] = {b.category_name: b.score for b in result.face_blendshapes[0]}
        frames.append(entry)
with open(out, "w") as handle:
    json.dump({"shrink": shrink, "frames": frames}, handle)
found = sum("points" in f for f in frames)
widths = [np.ptp([p[0] for p in f["points"]]) * shrink for f in frames if "points" in f]
print(f"frames {len(frames)}, face found {found}, face width in shrunk pixels about {np.median(widths) if widths else 0:.0f}")
