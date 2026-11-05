"""GEM-X's own box for the person it captures, per frame, so SAM 3D Body can be given the same person (mocap.js, the
user's go of 2026-11-05). GEM-X detects people with YOLOX, follows them with ByteTrack and keeps the track with the largest
summed box area, filling gaps by interpolation (gem/common/detectors/tracks.py); gem.pt keeps those boxes in its tracking
field. CPU only. Writes the same layout as person_boxes.py: {"width", "height", "boxes": [[x0, y0, x1, y1], ...]}, plus
"observed", false where GEM-X filled the box in.
Run from the GEM-X folder with its venv: python gem_person_boxes.py <gem.pt> <out.json>
"""

import json
import sys

import numpy as np
import torch

gem_file, out_file = sys.argv[1:3]
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
tracking = gem.get("tracking")
if not tracking or "boxes_xyxy" not in tracking:
    raise SystemExit(f"{gem_file} has no tracking boxes; it needs GEM-X's motion-video output")
boxes = np.asarray(tracking["boxes_xyxy"], dtype=float)
observed = np.asarray(tracking["observed_primary"], dtype=bool)
size = gem["video"]["normalized"]
if len(boxes) != int(size["frame_count"]):
    raise SystemExit(f"{len(boxes)} boxes for {size['frame_count']} frames")
result = {"width": int(size["width"]), "height": int(size["height"]), "boxes": boxes.round(2).tolist(), "observed": observed.tolist()}
with open(out_file, "w") as handle:
    json.dump(result, handle)
print(f"{len(boxes)} frames, seen in {int(observed.sum())}, filled in {int((~observed).sum())}")
