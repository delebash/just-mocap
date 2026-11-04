"""Brow keys from MediaPipe's own face points, built 2026-11-04 under "go brows" and not kept: scored one-sided, as ARKit
defines its keys, MediaPipe's own brow keys follow Multiface's real brows as well (up 0.86-0.91, down 0.97-0.98) and these
do no better (RESEARCH.md, 2026-11-04). Not in export_mocap.py; kept to repeat the measurement.

On Meta's Multiface (bench/brows_mf.js), MediaPipe's brow points follow the real brow at 0.87-0.97, while its own brow
blendshapes follow at 0.73-0.82. So the five brow keys take their timing from the points: the brow's height above its
eye (brow 105/334, inner brow 107/336, to the eye-corner midpoint, over the outer-corner distance, as face_measures.js
measures it). It is taken on the 3D points with the head's turn undone by MediaPipe's own facial transformation matrix,
so a head turn doesn't read as a brow move. Their size stays MediaPipe's. Each clip's measure is mapped onto
MediaPipe's own values for that key in the same clip by rank (quantile mapping, also called histogram matching), so a
clip whose brows MediaPipe reads at 0.1-0.3 stays at 0.1-0.3, its zeros stay zero, and only the timing changes. browDown
takes the brow height turned over. A key keeps MediaPipe's values when the points and that key disagree (correlation
under 0.3 in the expected direction), or when the face was found in fewer than 30 frames.
"""

import numpy as np

EYES = {"Right": ((33, 133), 105, 107), "Left": ((263, 362), 334, 336)}  # corners, brow, inner brow (face_measures.js)
OUTER = (33, 263)
KEYS = (
    ("browOuterUpRight", "browRight", 1),
    ("browDownRight", "browRight", -1),
    ("browOuterUpLeft", "browLeft", 1),
    ("browDownLeft", "browLeft", -1),
    ("browInnerUp", "inner", 1),
)
AGREEMENT = 0.3
MIN_FRAMES = 30


def frontal(points, matrix):
    """Points with y up and z toward the camera, the head's turn undone when a matrix is given. MediaPipe's facial
    transformation matrix maps its canonical face into a camera space with y up and z toward the viewer, while image
    points have y down and z away, so both axes are flipped first; then the rotation's transpose turns the face back."""
    p = np.asarray(points, float)[:, :3] * np.array([1.0, -1.0, -1.0])
    p = p - p.mean(0)
    if matrix is None:
        return p
    return p @ np.asarray(matrix, float)[:3, :3]


def heights(points, matrix=None):
    p = frontal(points, matrix)[:, :2]
    unit = np.linalg.norm(p[OUTER[0]] - p[OUTER[1]])
    out = {}
    for side, ((a, b), brow, inner) in EYES.items():
        middle = (p[a] + p[b]) / 2
        out[f"brow{side}"] = np.linalg.norm(p[brow] - middle) / unit
        out[f"inner{side}"] = np.linalg.norm(p[inner] - middle) / unit
    return out


def quantile_map(source, target):
    """Each source value replaced by the target's value at the same rank."""
    ranks = np.argsort(np.argsort(source)) / max(len(source) - 1, 1)
    return np.quantile(target, ranks)


def brow_keys(frames, points_key="points", turn=True):
    """frames: dicts with points (478 x 2 or 3), 'matrix' (4 x 4) and 'shapes' (MediaPipe's blendshapes), or without
    points where no face was found. Returns the frames' shapes with the five brow keys replaced, and a report per key."""
    found = [i for i, f in enumerate(frames) if f.get(points_key) is not None and f.get("shapes")]
    shapes = [dict(f["shapes"]) if f.get("shapes") else None for f in frames]
    if len(found) < MIN_FRAMES:
        return shapes, {"used": False, "reason": f"face in {len(found)} frames, under {MIN_FRAMES}"}
    measured = [heights(frames[i][points_key], frames[i].get("matrix") if turn else None) for i in found]
    series = {key: np.array([m[key] for m in measured]) for key in measured[0]}
    series["inner"] = (series["innerRight"] + series["innerLeft"]) / 2
    report = {"used": True}
    for key, measure, sign in KEYS:
        ours = sign * series[measure]
        theirs = np.array([frames[i]["shapes"][key] for i in found])
        agreement = float(np.corrcoef(ours, theirs)[0, 1]) if ours.std() > 0 and theirs.std() > 0 else float("nan")
        if not agreement > AGREEMENT:
            report[key] = f"MediaPipe's own (agreement {agreement:.2f})"
            continue
        for i, value in zip(found, quantile_map(ours, theirs)):
            shapes[i][key] = float(value)
        report[key] = f"from the points (agreement {agreement:.2f})"
    return shapes, report
