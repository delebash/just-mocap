"""Measures the fix the GEM-X issue suggests: take only x and z from correct_static_translation and keep the raw
vertical root motion, then GEM-X's own correct_static_pose. Writes a gem.pt copy with that world result, for
gem_body.py and truth_body.js. Also re-runs GEM-X's unchanged post-process to check it reproduces the saved result.

Run from the GEM-X folder with its venv: python keep_raw_y.py <gem.pt> <out.pt>
"""

import sys

import torch

from gem.motion.postprocess.api import PostprocessBody, SomaContactPostprocessor, ieee_geometry
from gem.motion.postprocess.contact import correct_static_pose, correct_static_translation

gem_file, out_file = sys.argv[1:3]
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
raw = {k: v.float() for k, v in gem["raw_predictions"]["pred_soma_params_global"].items()}
logits = gem["static_conf_logits"].float()
body = PostprocessBody(SomaContactPostprocessor("assets/soma", device="cpu").body_model)

with torch.inference_mode(), ieee_geometry():
    corrected = correct_static_translation(raw, logits, body)
    again = correct_static_pose({**raw, "transl": corrected}, logits, body)
    saved = gem["pred_soma_params_global"]
    print("re-run matches saved: transl", float((corrected - saved["transl"].float()).abs().max()), "body_pose", float((again - saved["body_pose"].float()).abs().max()))

    keep = corrected.clone()
    keep[..., 1] = raw["transl"][..., 1]
    joints = body(**{**raw, "transl": keep}, return_joints_only=True)["joints"]
    keep[..., 1] -= joints[..., 1].flatten(-2).min(dim=-1).values[:, None]
    pose = correct_static_pose({**raw, "transl": keep}, logits, body)

out = dict(gem)
out["pred_soma_params_global"] = {**gem["pred_soma_params_global"], "transl": keep.to(saved["transl"]), "body_pose": pose.to(saved["body_pose"])}
torch.save(out, out_file)
print("wrote", out_file)
