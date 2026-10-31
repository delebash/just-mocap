"""Draws RTMW's hand points on chosen frames, MediaPipe's beside them if it found any, so hands can be judged by eye.
Run: .dev/venv-tools/Scripts/python draw_hands.py <video> <rtmw.json> <mp.json> <out.png> <frame> [<frame> ...]
Also prints how many frames each side's mean hand score clears 0.3, 0.5 and 0.7.
"""

import json
import sys

import cv2
import numpy as np

video, rtmw_path, mp_path, out = sys.argv[1:5]
wanted = [int(v) for v in sys.argv[5:]]
rtmw = json.load(open(rtmw_path))
mp_data = json.load(open(mp_path))
frames = rtmw["frames"]
width, height = rtmw["width"], rtmw["height"]
HANDS = {"left": range(91, 112), "right": range(112, 133)}

for side, ids in HANDS.items():
    scores = np.array([[frame[i][2] for i in ids] for frame in frames]).mean(axis=1)
    print(side, f"mean score median {np.median(scores):.2f}", {t: int((scores > t).sum()) for t in (0.3, 0.5, 0.7)}, f"of {len(scores)}")

tiles = []
capture = cv2.VideoCapture(video)
for number in wanted:
    capture.set(cv2.CAP_PROP_POS_FRAMES, number)
    ok, frame = capture.read()
    if not ok:
        continue
    panel = frame.copy()
    centres = []
    for side, ids in HANDS.items():
        points = [frames[number][i] for i in ids]
        centres.append(np.mean([p[:2] for p in points], axis=0))
        for x, y, score in points:
            cv2.circle(panel, (int(x), int(y)), 2, (0, 255, 0) if score > 0.5 else (0, 0, 255), -1)
    for hand in mp_data["frames"][number]:
        for x, y in hand["screen"]:
            cv2.circle(panel, (int(x * width), int(y * height)), 2, (255, 0, 255), -1)
    for centre in centres:
        half = 70
        x, y = int(np.clip(centre[0], half, width - half)), int(np.clip(centre[1], half, height - half))
        tiles.append(cv2.resize(panel[y - half : y + half, x - half : x + half], (280, 280), interpolation=cv2.INTER_NEAREST))
cv2.imwrite(out, np.hstack(tiles))
