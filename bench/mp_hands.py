"""MediaPipe Hand Landmarker on one video, VIDEO mode, as an app would run it. Writes world landmarks per frame as JSON.
Run with JustStage's tool environment: .dev/venv-tools/Scripts/python mp_hands.py <video> <hand_landmarker.task> <out.json>
"""

import json
import sys
import time

import cv2
import mediapipe as mp
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

video, model, out = sys.argv[1:4]
capture = cv2.VideoCapture(video)
fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
options = vision.HandLandmarkerOptions(
    base_options=mp_tasks.BaseOptions(model_asset_path=model),
    running_mode=vision.RunningMode.VIDEO,
    num_hands=2,
)
frames = []
started = time.time()
with vision.HandLandmarker.create_from_options(options) as detector:
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        image = mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        result = detector.detect_for_video(image, int(index * 1000 / fps))
        hands = []
        for label, world, screen in zip(result.handedness, result.hand_world_landmarks, result.hand_landmarks):
            hands.append(
                {
                    "side": label[0].category_name,
                    "score": label[0].score,
                    "world": [[p.x, p.y, p.z] for p in world],
                    "screen": [[p.x, p.y] for p in screen],
                }
            )
        frames.append(hands)
        index += 1
elapsed = time.time() - started
json.dump({"fps": fps, "seconds": elapsed, "frames": frames}, open(out, "w"))
print(f"{len(frames)} frames, {elapsed:.1f} s, {elapsed / max(len(frames), 1) * 1000:.1f} ms a frame, hands found in "
      f"{sum(1 for f in frames if f)} frames, both in {sum(1 for f in frames if len(f) == 2)}")
