"""Person boxes from MediaPipe pose, CPU, for the top-down RTMW test. Writes [x0, y0, x1, y1] per frame, null if no pose.
Run: .dev/venv-tools/Scripts/python person_boxes.py <video> <pose.task> <out.json>
"""

import json
import sys

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

video, model, out = sys.argv[1:4]
capture = cv2.VideoCapture(video)
fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))
options = vision.PoseLandmarkerOptions(base_options=mp_tasks.BaseOptions(model_asset_path=model), running_mode=vision.RunningMode.VIDEO, num_poses=1)
boxes = []
with vision.PoseLandmarker.create_from_options(options) as pose:
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = pose.detect_for_video(image, int(index * 1000 / fps))
        if result.pose_landmarks:
            points = np.array([[m.x * width, m.y * height] for m in result.pose_landmarks[0]])
            low, high = points.min(axis=0), points.max(axis=0)
            centre, size = (low + high) / 2, (high - low) * 1.3
            boxes.append([float(centre[0] - size[0] / 2), float(centre[1] - size[1] / 2), float(centre[0] + size[0] / 2), float(centre[1] + size[1] / 2)])
        else:
            boxes.append(None)
        index += 1
json.dump({"width": width, "height": height, "fps": fps, "boxes": boxes}, open(out, "w"))
print(f"{len(boxes)} frames, {sum(1 for b in boxes if b)} with a person")
