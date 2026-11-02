"""MediaPipe Face Landmarker on one video, VIDEO mode, on a head crop taken from GEM-X's 2D points, as a full-body
pipeline would run it (ComfyUI's SAM 3D Body face node crops the head the same way). Writes per frame the 52 ARKit
blendshapes, the 478 face points in full-image pixels, and the crop size.
Run with JustStage's tool environment: .dev/venv-tools/Scripts/python mp_face.py <video> <face_landmarker.task> <head2d.json> <out.json>
"""

import json
import sys
import time

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

video, model, head_file, out = sys.argv[1:5]
CROP_PIXELS = 384
head = {name: np.asarray(points) for name, points in json.load(open(head_file)).items()}
capture = cv2.VideoCapture(video)
fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
options = vision.FaceLandmarkerOptions(
    base_options=mp_tasks.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.VIDEO,
    num_faces=1,
    output_face_blendshapes=True,
    output_facial_transformation_matrixes=True,
)
frames = []
started = time.time()
with vision.FaceLandmarker.create_from_options(options) as detector:
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok or index >= len(head["Head"]):
            break
        eyes = (head["LeftEye"][index, :2] + head["RightEye"][index, :2]) / 2
        side = max(64.0, 2.2 * float(np.linalg.norm(head["HeadEnd"][index, :2] - head["Neck2"][index, :2])))
        x0, y0 = eyes - side / 2
        crop = cv2.getRectSubPix(frame, (int(round(side)), int(round(side))), tuple(float(v) for v in eyes))
        crop = cv2.resize(crop, (CROP_PIXELS, CROP_PIXELS), interpolation=cv2.INTER_CUBIC)
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(crop, cv2.COLOR_BGR2RGB))
        result = detector.detect_for_video(image, int(index * 1000 / fps))
        entry = {"side": side}
        if result.face_landmarks:
            scale = side / CROP_PIXELS
            entry["points"] = [[x0 + p.x * CROP_PIXELS * scale, y0 + p.y * CROP_PIXELS * scale, p.z * side] for p in result.face_landmarks[0]]
            entry["shapes"] = {b.category_name: b.score for b in result.face_blendshapes[0]}
            entry["matrix"] = np.asarray(result.facial_transformation_matrixes[0]).tolist()
        frames.append(entry)
        index += 1
seconds = time.time() - started
with open(out, "w") as handle:
    json.dump({"fps": fps, "seconds": seconds, "frames": frames}, handle)
found = sum("points" in f for f in frames)
print(f"frames {len(frames)}, face found {found}, median crop {np.median([f['side'] for f in frames]):.0f} px, {seconds:.1f} s")
