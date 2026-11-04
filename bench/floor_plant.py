"""Floor plant for GEM-X's contact cleanup: planted feet held on one floor, so the world motion doesn't drift up or down.
GEM-X's correct_static_translation sums the planted joints' vertical slips into the root, 26-30 cm over a 10 s walk
(RESEARCH.md, 2026-11-03 and 2026-11-04). CPU only. Measured and not in mocap.js: it misses its keep-test on foot slide
(0.1-0.4 mm worse) and adds bob to planted feet (RESEARCH.md, 2026-11-04).

GEM-X's own two post-process steps run as GEM-X runs them (gem/motion/postprocess/api.py:98-99), with one step between:
1. correct_static_translation: GEM-X's root path from its contacts.
2. The plant. Where GEM-X marks a heel (Foot) or toe (ToeBase) joint firmly planted (contact above 0.8, so a half-planted
   raised heel doesn't count), that joint belongs at its standing height: its height in the person's rest pose above the
   rest pose's lowest joint. Each frame's value is the contact-weighted mean of standing height minus joint height. A
   Whittaker-Henderson smoother (penalised least squares on second differences) fits it closely where contact is firm and
   bends it smoothly across the swings. The result is added to the root height, which keeps GEM-X's vertical motion
   between steps (a walk's bounce, a jump) and puts every firm stance on one floor at height 0.
   The idea is UnderPressure's footskate cleanup (Mourot et al., SCA 2022), which pins each contact at ground height,
   here for the root height only. Its code is licensed for research only and none of it is copied.
3. correct_static_pose: GEM-X's leg IK, unchanged.
It assumes one flat floor, so stairs and ramps would be flattened.

Tried and dropped (RESEARCH.md, 2026-11-04):
- a straight blend then Gaussian smoothing, which let the offset ramp inside stances;
- one level per foot per stance, which bobbed slightly more;
- GEM-X's leg IK aimed at the floor, which was mixed on slide and left the bob.
The bob comes from GEM-X itself: in double support its two planted feet can sit 8-14 cm apart in height, and one root
offset can't put both on the floor.

Run from the GEM-X folder with its venv: python floor_plant.py <gem.pt> <out.pt>
Writes a gem.pt-shaped file: world parameters replaced, and the camera parameters given the new body pose, as GEM-X does.
"""

import sys

import numpy as np
import torch

from gem.motion.postprocess.api import PostprocessBody, SomaContactPostprocessor, ieee_geometry
from gem.motion.postprocess.contact import SOMA_CONTACT_JOINT_IDS, correct_static_pose, correct_static_translation

FIRM = 0.8
FEET = list(SOMA_CONTACT_JOINT_IDS[:4])  # LeftFoot, LeftToeBase, RightFoot, RightToeBase; hands aren't floor contacts
SMOOTH = 10.0


def whittaker(values, weights, smooth):
    """Whittaker-Henderson smoothing: the curve closest to the weighted values with small second differences, the
    standard penalised least squares. Frames with no weight are filled by the smoothness alone."""
    count = len(values)
    second = np.diff(np.eye(count), n=2, axis=0)
    system = np.diag(weights) + smooth * second.T @ second
    return np.linalg.solve(system, weights * np.nan_to_num(values))


def plant(gem, smooth=SMOOTH):
    raw = {k: v.float() for k, v in gem["raw_predictions"]["pred_soma_params_global"].items()}
    logits = gem["static_conf_logits"].float()
    body = PostprocessBody(SomaContactPostprocessor("assets/soma", device="cpu").body_model)
    with torch.inference_mode(), ieee_geometry():
        transl = correct_static_translation(raw, logits, body)
        joints = body(**{**raw, "transl": transl}, return_joints_only=True)["joints"][0]
        still = {k: torch.zeros_like(raw[k]) for k in ("global_orient", "body_pose", "transl")}
        rest = body(**{**raw, **still}, return_joints_only=True)["joints"][0, 0]
        standing = rest[FEET, 1] - rest[:, 1].min()
        contact = logits[0, :, :4].sigmoid()
        weight = contact * (contact > FIRM)
        total = weight.sum(-1)
        known = (total > 0).numpy()
        if known.sum() < 2:
            raise SystemExit("fewer than two frames with a firm foot contact: nothing to plant")
        values = (((standing[None] - joints[:, FEET, 1]) * weight).sum(-1) / total.clamp_min(1e-6)).numpy()
        offset = torch.from_numpy(whittaker(values, total.numpy(), smooth)).float()
        planted = transl.clone()
        planted[0, :, 1] += offset
        pose = correct_static_pose({**raw, "transl": planted}, logits, body)
    world = gem["pred_soma_params_global"]
    camera = gem["pred_soma_params_incam"]
    out = dict(gem)
    out["pred_soma_params_global"] = {**world, "transl": planted.to(world["transl"]), "body_pose": pose.to(world["body_pose"])}
    out["pred_soma_params_incam"] = {**camera, "body_pose": pose.to(camera["body_pose"])}
    out["coordinates"] = {**gem.get("coordinates", {}), "global": "world_meters_after_contact_ik_and_floor_plant"}
    out["floor_plant"] = {
        "firm_contact": FIRM,
        "standing_heights_m": [round(float(h), 4) for h in standing],
        "firm_frames": int(known.sum()),
        "offset_m": [round(float(offset.min()), 4), round(float(offset.max()), 4)],
    }
    return out


if __name__ == "__main__":
    gem_file, out_file = sys.argv[1:3]
    result = plant(torch.load(gem_file, map_location="cpu", weights_only=False))
    torch.save(result, out_file)
    info = result["floor_plant"]
    print(f"floor plant: {info['firm_frames']} frames with a firm foot contact, standing heights {info['standing_heights_m']} m, offset {info['offset_m'][0]:+.3f} to {info['offset_m'][1]:+.3f} m")
