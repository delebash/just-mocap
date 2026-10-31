"""MediaPipe the way XR Animator uses it: pose first, then the hand model on an enlarged crop around each wrist, then a
causal filter is left to the scoring. This tests "could MediaPipe be fixed", on the CPU.
Run: .dev/venv-tools/Scripts/python mp_crops.py <video> <pose.task> <hand.task> <out.json>
"""

import json
import sys
import time

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

video, pose_model, hand_model, out = sys.argv[1:5]
CROP_OUT = 384  # the crop is scaled up to this before the hand model's own palm detector and 224 px landmark input

capture = cv2.VideoCapture(video)
fps = capture.get(cv2.CAP_PROP_FPS) or 30.0
width = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH))
height = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT))

pose_options = vision.PoseLandmarkerOptions(
    base_options=mp_tasks.BaseOptions(model_asset_path=pose_model),
    running_mode=vision.RunningMode.VIDEO,
    num_poses=1,
)
hand_options = vision.HandLandmarkerOptions(
    base_options=mp_tasks.BaseOptions(model_asset_path=hand_model),
    running_mode=vision.RunningMode.IMAGE,
    num_hands=1,
    min_hand_detection_confidence=0.3,
    min_hand_presence_confidence=0.3,
)

# Pose landmark indices: 13/14 elbow, 15/16 wrist, 17/18 pinky, 19/20 index, 11/12 shoulder.
SIDES = {"Left": (13, 15, 17, 19), "Right": (14, 16, 18, 20)}


def crop_box(points, elbow, wrist, pinky, index):
    forearm = np.linalg.norm(points[wrist] - points[elbow])
    knuckles = (points[pinky] + points[index]) / 2
    centre = points[wrist] + (knuckles - points[wrist]) * 1.2
    side = max(forearm * 1.2, 96.0)
    return centre, side


frames = []
visible = {"Left": 0, "Right": 0}
started = time.time()
with vision.PoseLandmarker.create_from_options(pose_options) as pose, vision.HandLandmarker.create_from_options(hand_options) as hand:
    index = 0
    while True:
        ok, frame = capture.read()
        if not ok:
            break
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = pose.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb), int(index * 1000 / fps))
        hands = []
        if result.pose_landmarks:
            marks = result.pose_landmarks[0]
            points = np.array([[m.x * width, m.y * height] for m in marks])
            for side, (elbow, wrist, pinky, tip) in SIDES.items():
                if not (0 <= points[wrist][0] < width and 0 <= points[wrist][1] < height):
                    continue
                visible[side] += 1
                centre, size = crop_box(points, elbow, wrist, pinky, tip)
                half = size / 2
                source = np.float32([[centre[0] - half, centre[1] - half], [centre[0] + half, centre[1] - half], [centre[0] - half, centre[1] + half]])
                target = np.float32([[0, 0], [CROP_OUT, 0], [0, CROP_OUT]])
                matrix = cv2.getAffineTransform(source, target)
                patch = cv2.warpAffine(rgb, matrix, (CROP_OUT, CROP_OUT), flags=cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
                found = hand.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=patch))
                if found.hand_landmarks:
                    screen = [[(p.x * size + centre[0] - half) / width, (p.y * size + centre[1] - half) / height] for p in found.hand_landmarks[0]]
                    hands.append(
                        {"side": side, "score": found.handedness[0][0].score, "world": [[p.x, p.y, p.z] for p in found.hand_world_landmarks[0]], "screen": screen}
                    )
        frames.append(hands)
        index += 1
elapsed = time.time() - started
json.dump({"fps": fps, "seconds": elapsed, "frames": frames, "wristInFrame": visible}, open(out, "w"))
count = {side: sum(1 for f in frames if any(h["side"] == side for h in f)) for side in SIDES}
print(f"{len(frames)} frames, {elapsed / max(len(frames), 1) * 1000:.0f} ms a frame, found {count}, wrist in frame {visible}")
