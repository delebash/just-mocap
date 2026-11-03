"""Joins the per-piece SAM 3D Body saves (JustMocapSaveMHR .npz files) back into one clip, in order.

SAM 3D Body works frame by frame, so running a clip in pieces changes nothing but memory use: ComfyUI decodes a whole
video into 32-bit floats (comfy_api/latest/_input_impl/video_types.py, `a.float() / 255.0`), which is about 30 GB for
10 s of 4K. `mocap.js` cuts the 30 fps clip into pieces and calls this to join the results.
Run: python concat_mhr.py <out.npz> <expected frames> <piece.npz> [piece.npz ...]
"""

import sys

import numpy as np

out_file, expected, *pieces = sys.argv[1:]
loaded = [np.load(p) for p in pieces]
keys = loaded[0].files
for p, data in zip(pieces, loaded):
    if data.files != keys:
        raise SystemExit(f"{p} has fields {data.files}, the first piece {keys}")
joined = {k: np.concatenate([d[k] for d in loaded]) for k in keys if k != "faces"}
joined["faces"] = loaded[0]["faces"]
frames = len(joined["found"])
if frames != int(expected):
    raise SystemExit(f"pieces hold {frames} frames, the clip {expected}")
np.savez_compressed(out_file, **joined)
print(f"joined {len(pieces)} pieces, {frames} frames, person found in {int(joined['found'].sum())}")
