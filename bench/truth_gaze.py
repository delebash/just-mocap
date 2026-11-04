"""Gaze against the gaze ruler's dots (bench/gaze/index.html, bench/gaze_ruler.js): MediaPipe Face Landmarker on any
recording of the face (iPhone, Android, a webcam through OBS), lined up with the page by its white flashes, scored on
where the eyes point while each dot holds still.

Measures, per eye: the pupil's place in the eye (along the corner line and across it, in eye widths, as
face_measures.js), and MediaPipe's eyeLook blendshapes (out minus in, up minus down). Each is correlated with the dot's
place on the screen. A mirrored video flips the sign of the left-right scores, so the size of the correlation is the
score and its sign is shown beside it. With the distance and screen width typed on the page, each measure is also fitted
to the dot's angle, and the spread left over is its accuracy in degrees after a per-person fit, as eye trackers report.
Head turn is scored the same way, as a check that the head stayed still.

Run with JustStage's tool environment, from E:\\Dev\\Web\\just-mocap:
  python bench/truth_gaze.py <video> <schedule.json> <face_landmarker.task> [out.json]
"""

import json
import os
import subprocess
import sys
import tempfile

import cv2
import mediapipe as mp
import numpy as np
from mediapipe.tasks import python as mp_tasks
from mediapipe.tasks.python import vision

FPS = 30.0
WIDTH = 1280  # MediaPipe finds and crops the face itself; a seated face stays large at this width.
SETTLE = 0.6  # seconds after a dot moves before the eyes count as on it
RIGHT, LEFT = (33, 133), (263, 362)  # MediaPipe's eye corners, outer then inner, as face_measures.js
IRISES = (468, 473)


def decode(video, folder):
    """A steady 30 fps H.264 copy at WIDTH, rotation applied, so frame index is time and OpenCV reads any source."""
    copy = os.path.join(folder, "gaze30.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", video, "-vf", f"fps={FPS:g},scale={WIDTH}:-2", "-c:v", "libx264", "-crf", "18", "-preset", "veryfast", "-pix_fmt", "yuv420p", "-an", copy], check=True)
    return copy


def find_flashes(luma, period, on):
    """The time of the first of three flashes, and how clearly they stand out of the brightness noise.

    A matched filter on the brightness steps finds the frames: the three rises at their spacing, and the falls `on`
    later (either of the two frames around it, since the fall lands mid-frame). Each rise is then placed to a fraction
    of a frame where the brightness crosses halfway, so a flash that starts mid-exposure is timed by how lit that frame is.
    """
    step = np.diff(luma, prepend=luma[0])
    gaps = [int(round(k * period * FPS)) for k in range(3)]
    lit = on * FPS
    falls = (int(np.floor(lit)), int(np.ceil(lit)))
    span = gaps[-1] + falls[1] + 6
    scores = np.full(len(luma), -np.inf)
    for t in range(4, len(luma) - span):
        scores[t] = sum(step[t + g] - min(step[t + g + falls[0]], step[t + g + falls[1]]) for g in gaps)
    best = int(np.argmax(scores))
    times = []
    for k, g in enumerate(gaps):
        o = best + g
        base, peak = np.median(luma[o - 4 : o - 1]), np.median(luma[o + 1 : o + min(4, falls[0])])
        level = (base + peak) / 2
        j = next((j for j in range(o - 2, o + 3) if luma[j] >= level), o)
        crossing = j - 1 + (level - luma[j - 1]) / (luma[j] - luma[j - 1]) if luma[j] != luma[j - 1] else j
        times.append(crossing / FPS - k * period)
    noise = np.median(np.abs(step)) + 1e-6
    return float(np.mean(times)), scores[best] / 6 / noise


def correlation(a, b):
    a, b = np.asarray(a, float), np.asarray(b, float)
    if a.std() == 0 or b.std() == 0:
        return float("nan")
    return float(np.corrcoef(a, b)[0, 1])


def pupil_place(points, eye):
    """Pupil along the corner line (0 = middle) and across it, in eye widths; the nearer iris is this eye's."""
    a, b = points[eye[0]], points[eye[1]]
    middle = (a + b) / 2
    pupil = min((points[i] for i in IRISES), key=lambda p: np.linalg.norm(p - middle))
    axis = b - a
    width = np.linalg.norm(axis)
    offset = pupil - middle
    return float(offset @ axis) / width**2, float(offset[1] * axis[0] - offset[0] * axis[1]) / width**2


def main():
    video, schedule_file, model = sys.argv[1:4]
    out_file = sys.argv[4] if len(sys.argv) > 4 else None
    schedule = json.load(open(schedule_file))
    period = schedule["flashOnSeconds"] + schedule["flashOffSeconds"]
    with tempfile.TemporaryDirectory(dir=os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tmp")) as folder:
        capture = cv2.VideoCapture(decode(video, folder))
        options = vision.FaceLandmarkerOptions(
            base_options=mp_tasks.BaseOptions(model_asset_path=model),
            running_mode=vision.RunningMode.VIDEO,
            num_faces=1,
            output_face_blendshapes=True,
            output_facial_transformation_matrixes=True,
        )
        frames = []
        with vision.FaceLandmarker.create_from_options(options) as detector:
            index = 0
            while True:
                ok, frame = capture.read()
                if not ok:
                    break
                height, width = frame.shape[:2]
                result = detector.detect_for_video(mp.Image(image_format=mp.ImageFormat.SRGB, data=cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)), int(index * 1000 / FPS))
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                entry = {"luma": float(gray.mean())}
                if result.face_landmarks:
                    points = np.array([[p.x * width, p.y * height] for p in result.face_landmarks[0]])
                    x0, y0 = np.maximum(points.min(0).astype(int), 0)
                    x1, y1 = points.max(0).astype(int)
                    entry["luma"] = float(gray[y0:y1, x0:x1].mean())  # the face catches the screen's light best
                    entry["points"] = points
                    entry["shapes"] = {b.category_name: b.score for b in result.face_blendshapes[0]}
                    entry["matrix"] = np.asarray(result.facial_transformation_matrixes[0])
                frames.append(entry)
                index += 1
        capture.release()
    found = sum("points" in f for f in frames)
    print(f"{len(frames)} frames at {FPS:g} fps, face found in {found}")

    # --- Line up the page's clock with the video: the first flash of each set of three, at the start and at the end.
    luma = np.array([f["luma"] for f in frames])
    half = len(luma) // 2
    start, start_strength = find_flashes(luma[:half], period, schedule["flashOnSeconds"])
    end, end_strength = find_flashes(luma[half:], period, schedule["flashOnSeconds"])
    end += half / FPS
    page_start, page_end = schedule["flashes"][0], schedule["flashes"][3]
    scale = (end - start) / (page_end - page_start)
    offset = start - page_start * scale
    print(f"flashes at {start:.2f} s and {end:.2f} s of the video (strength {start_strength:.1f}, {end_strength:.1f}); page clock to video: x{scale:.5f} + {offset:.3f} s")
    if min(start_strength, end_strength) < 3 or abs(scale - 1) > 0.01:
        raise SystemExit("the flashes weren't found clearly: record the whole page from before Start to after the last flashes, with the face lit by the screen")

    # --- Samples while a dot holds, after the eyes have settled on it.
    hold = schedule["holdSeconds"]
    targets = schedule["targets"]
    rows = []
    for index, frame in enumerate(frames):
        if "points" not in frame:
            continue
        page = (index / FPS - offset) / scale
        current = [k for k, t in enumerate(targets) if t["onset"] <= page]
        if not current:
            continue
        k = current[-1]
        since = page - targets[k]["onset"]
        if not (SETTLE <= since <= hold - 0.1) or page > schedule["dotsEnd"]:
            continue
        s = frame["shapes"]
        R = frame["matrix"][:3, :3]
        right, left = pupil_place(frame["points"], RIGHT), pupil_place(frame["points"], LEFT)
        rows.append({
            "target": k, "x": targets[k]["x"], "y": targets[k]["y"],
            "rightAlong": right[0], "rightAcross": right[1], "leftAlong": left[0], "leftAcross": left[1],
            "rightLookSide": s["eyeLookOutRight"] - s["eyeLookInRight"], "leftLookSide": s["eyeLookInLeft"] - s["eyeLookOutLeft"],
            "rightLookUp": s["eyeLookUpRight"] - s["eyeLookDownRight"], "leftLookUp": s["eyeLookUpLeft"] - s["eyeLookDownLeft"],
            "headYaw": float(np.degrees(np.arctan2(R[0, 2], R[2, 2]))), "headPitch": float(np.degrees(np.arcsin(-np.clip(R[1, 2], -1, 1)))),
        })
    print(f"{len(rows)} frames while a dot held, from {len({r['target'] for r in rows})} of {len(targets)} dots")
    if len(rows) < 30:
        raise SystemExit("too few frames on the dots to score")

    distance, width_cm = schedule.get("distanceCm"), schedule["screen"].get("widthCm")
    angles = None
    if distance and width_cm:
        height_cm = width_cm * schedule["screen"]["cssHeight"] / schedule["screen"]["cssWidth"]
        angles = {"x": lambda v: np.degrees(np.arctan((v - 0.5) * width_cm / distance)), "y": lambda v: np.degrees(np.arctan((v - 0.5) * height_cm / distance))}
    result = {"frames": len(frames), "faceFound": found, "scored": len(rows), "flashStart": start, "flashEnd": end, "measures": {}}
    print("measure            against  follows  sign  per-dot means follow" + ("  accuracy after a linear fit, deg" if angles else ""))
    for key, axis in (
        ("rightAlong", "x"), ("leftAlong", "x"), ("rightLookSide", "x"), ("leftLookSide", "x"), ("headYaw", "x"),
        ("rightAcross", "y"), ("leftAcross", "y"), ("rightLookUp", "y"), ("leftLookUp", "y"), ("headPitch", "y"),
    ):
        values = np.array([r[key] for r in rows])
        place = np.array([r[axis] for r in rows])
        r = correlation(values, place)
        means = [(np.mean([v for v, row in zip(values, rows) if row["target"] == k]), targets[k][axis]) for k in sorted({row["target"] for row in rows})]
        per_dot = correlation([m for m, _ in means], [p for _, p in means])
        line = f"  {key:<16} dot {axis}    {abs(r):5.2f}  {'+' if r >= 0 else '-':>4}  {abs(per_dot):6.2f}"
        entry = {"against": axis, "follows": r, "perDot": per_dot}
        if angles:
            truth = angles[axis](place)
            fit = np.polyfit(values, truth, 1)
            entry["accuracyDegrees"] = float(np.std(truth - np.polyval(fit, values)))
            line += f"  {entry['accuracyDegrees']:20.1f}"
        result["measures"][key] = entry
        print(line)
    if out_file:
        with open(out_file, "w") as handle:
            json.dump(result, handle, indent=1)


if __name__ == "__main__":
    main()
