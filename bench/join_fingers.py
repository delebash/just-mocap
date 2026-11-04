"""Joins SAM 3D Body's fingers onto GEM-X's body, and writes hand points for truth_hands.js. CPU only.

SAM 3D Body's MHR mesh is turned into SOMA joint rotations by SOMA's own PoseInversion, then into the relative
convention GEM-X uses with SOMA's remove_joint_orient_local (its docstring names exactly this use). Only the finger
joints are copied into GEM-X's pose; GEM-X keeps its body, wrists and world path.

Writes two point sets: "samSoma" is SAM 3D Body's whole pose in SOMA (the conversion alone), "joined" is GEM-X's body
with SAM's fingers. Scoring both against the truth shows what the conversion loses and what the join loses.

Run from the GEM-X folder with its venv:
  python join_fingers.py <gem.pt> <sam-mhr.npz> <out.json> [repose 1|0] [fit json] [frame|mean] [none|default|strong] [wrist gemx|sam]
The optional fit json passes PoseInversion.fit arguments, e.g. '{"finger_iters": 2, "lie_iters": 5}'.
The last argument smooths the copied finger rotations over time with SOMA's own RTS smoother on SO(3), using that
preset's hand gains; GEM-X's body is left as it is. The joined parameters are also saved beside the json, as .npz.
"""

import json
import sys
from pathlib import Path

import numpy as np
import torch
from soma import SOMALayer, Unit
from soma.fitting import PoseInversion
from soma.fitting.rts_smoothing import RTS_SMOOTHING_PRESETS, rts_smooth_rotations
from soma.geometry.rig_utils import precompute_joint_orient, remove_joint_orient_local
from scipy.spatial.transform import Rotation

from gem.motion.geometry import MotionGeometry

# Not soma.geometry.transforms.rotvec_to_matrix: in py-soma-x 0.3.3 it scales a unit axis by sin(t)/t, so a 90-degree
# turn comes out as a 51-degree non-rotation. Its matrix_to_rotvec is right, but one library for both directions is safer.


def rotvec_to_matrix(rotvec):
    return torch.from_numpy(Rotation.from_rotvec(rotvec.reshape(-1, 3).double().numpy()).as_matrix()).reshape(*rotvec.shape, 3).float()


def matrix_to_rotvec(matrix):
    return torch.from_numpy(Rotation.from_matrix(matrix.reshape(-1, 3, 3).double().numpy()).as_rotvec()).reshape(*matrix.shape[:-1]).float()

gem_file, sam_file, out_file = sys.argv[1:4]
repose = (sys.argv[4] if len(sys.argv) > 4 else "1") == "1"
fit_options = json.loads(sys.argv[5]) if len(sys.argv) > 5 and sys.argv[5] != "-" else {}
# "frame" fits each frame with SAM's own shape for that frame; "mean" uses one average shape for the clip.
shape_mode = sys.argv[6] if len(sys.argv) > 6 else "frame"
smoothing = sys.argv[7] if len(sys.argv) > 7 else "none"
# Wrist: "gemx" keeps GEM-X's (24-45° off close up, truth_wrist.js, RESEARCH.md 2026-11-03); "sam" copies SAM 3D
# Body's wrist rotation as it is (17° on average); "arm" gives the hand SAM's orientation relative to the arm plane on
# GEM-X's arm, which carries SAM's forearm roll too (14.5° on average, the level of SAM alone). mocap.js uses "arm".
wrist_source = sys.argv[8] if len(sys.argv) > 8 else "gemx"
FINGERS = ("Thumb", "Index", "Middle", "Ring", "Pinky")


def body_to_21(side):
    """SOMA names for one hand as the 21 points. Finger bone 1 is the metacarpal, so fingers start at 2."""
    prefix = f"{side}Hand"
    points = [prefix, *(f"{prefix}Thumb{i}" for i in (1, 2, 3)), f"{prefix}ThumbEnd"]
    for finger in FINGERS[1:]:
        points += [f"{prefix}{finger}{i}" for i in (2, 3, 4)] + [f"{prefix}{finger}End"]
    return points


# --- SAM 3D Body's mesh, turned into SOMA rotations.
sam = np.load(sam_file)
found = torch.from_numpy(sam["found"])
vertices = torch.from_numpy(sam["pred_vertices"]).float()
shape = torch.from_numpy(sam["shape_params"]).float()
scales = torch.from_numpy(sam["mhr_model_params"]).float()[:, -68:]
layer = SOMALayer(
    "assets/soma",
    identity_model_type="mhr",
    device="cpu",
    output_unit=Unit.METERS,
    enable_procedural_transforms=True,
    reference_pose={"version": "0.2.0"},
)
public = [str(n) for n in layer.public_joint_names]
inversion = PoseInversion(layer, low_lod=False)
if shape_mode == "frame":
    shape = torch.where(found[:, None], shape, shape[found].mean(0, keepdim=True))
    scales = torch.where(found[:, None], scales, scales[found].mean(0, keepdim=True))
else:
    shape, scales = shape[found].mean(0, keepdim=True), scales[found].mean(0, keepdim=True)
if "autograd_iters" in fit_options and shape.shape[0] > 1:
    # PoseInversion's autograd refinement fails on per-frame shapes in py-soma-x 0.3.3: its own chunking slices the
    # bind cache but not the skinning layer ("Incompatible batches: rotations=16, bind=300", batched_skinning.py:504),
    # and an identity prepared with gradients on fails the second backward pass. So each chunk's identity is prepared
    # here, without gradients. Passing autograd_iters 0 takes this path too, as the baseline for a refined run.
    parts = []
    for start in range(0, len(vertices), 16):
        end = start + 16
        with torch.no_grad():
            inversion.prepare_identity(shape[start:end], scales[start:end], repose_to_bind_pose=repose)
        parts.append(inversion.fit(torch.nan_to_num(vertices[start:end]), **fit_options))
    result = {key: torch.cat([part[key] for part in parts]) for key in parts[0]}
else:
    inversion.prepare_identity(shape, scales, repose_to_bind_pose=repose)
    result = inversion.fit(torch.nan_to_num(vertices), batch_size=16, **fit_options)
orient, parent_t = precompute_joint_orient(layer.get_reference_pose(version="0.2.0").to(result["rotations"]), layer.output_joint_parent_ids)
relative = remove_joint_orient_local(result["rotations"], orient, parent_t)[:, 1:]  # drop the virtual Root: 77 joints, Hips first
error_mm = result["per_vertex_error"][found].mean().item() * 1000

# SAM's whole pose in SOMA, posed with SAM's own shape, for the conversion-only score.
layer.prepare_identity(shape, scales)
sam_joints = layer.pose(relative, transl=result["root_translation"], pose2rot=False, fk_only=True)["joints"]

# --- GEM-X's pose with SAM's fingers.
gem = torch.load(gem_file, map_location="cpu", weights_only=False)
finger_ids = [i for i, n in enumerate(public[2:]) if "Hand" in n and any(f in n for f in FINGERS)]
if wrist_source in ("sam", "arm"):
    finger_ids += [i for i, n in enumerate(public[2:]) if n in ("LeftHand", "RightHand")]
elif wrist_source != "gemx":
    raise SystemExit("wrist source must be gemx, sam or arm")
index = {name: i for i, name in enumerate(public[1:])}  # 77 joints, Hips first
parents77 = [int(p) - 1 for p in layer.output_joint_parent_ids[1:]]  # Hips' parent, the virtual Root, becomes -1


def chain_world(rel):
    """World rotations relative to the rest pose (W = G O^T) from SOMA's T-pose-relative rotations, which are
    W_parent^T W_joint (rig_utils.remove_joint_orient_local: O_parent R_abs O^T). rel is (T, 77, 3, 3), Hips first."""
    world = torch.empty_like(rel)
    for j, p in enumerate(parents77):
        world[:, j] = rel[:, j] if p < 0 else world[:, p] @ rel[:, j]
    return world


def arm_frame(joints, side):
    """Columns: elbow to wrist, then the arm plane (shoulder, elbow, wrist) and its normal. joints is (T, 77, 3)."""
    shoulder, elbow, wrist = (joints[:, index[f"{side}{n}"]] for n in ("Arm", "ForeArm", "Hand"))
    x = torch.nn.functional.normalize(wrist - elbow, dim=-1)
    z = torch.nn.functional.normalize(torch.cross(x, shoulder - elbow, dim=-1), dim=-1)
    return torch.stack([x, torch.cross(z, x, dim=-1), z], -1)


sam_world = chain_world(relative) if wrist_source == "arm" else None
geometry = MotionGeometry(soma_assets="assets/soma", device="cpu", lod="low")
names = [n for n in geometry.body_model.runtime.rig_data["joint_names"] if "Twist" not in n and n != "Root"]
if [str(n) for n in names] != public[1:]:
    raise SystemExit("GEM-X and the MHR layer list SOMA's joints differently")


fps = float(gem["sampling_fps"])


def joined(key):
    params = {k: v.float().clone() for k, v in gem[key].items()}
    length = params["body_pose"].shape[1]
    if length != relative.shape[0]:
        raise SystemExit(f"GEM-X has {length} frames, SAM 3D Body {relative.shape[0]}")
    pose = rotvec_to_matrix(params["body_pose"].reshape(1, length, 76, 3))
    use = found[None, :, None]
    source = relative[:, 1:].clone()  # SAM's 76 body_pose rotations
    if wrist_source == "arm":
        # Keep GEM-X's arm and give its hand SAM's orientation relative to the arm plane: hand world W' = F_gem F_sam^T
        # W_sam, then the wrist rotation is W_forearm^T W'. This carries SAM's forearm roll too, not only its wrist.
        gem_world = chain_world(torch.cat([rotvec_to_matrix(params["global_orient"].reshape(1, length, 1, 3)), pose], 2)[0])
        with torch.no_grad():
            gem_joints = geometry(params)["joints"][0].detach()
        for side in ("Left", "Right"):
            hand = index[f"{side}Hand"]
            target = arm_frame(gem_joints, side) @ arm_frame(sam_joints.detach(), side).transpose(-1, -2) @ sam_world[:, hand]
            source[:, hand - 1] = (gem_world[:, index[f"{side}ForeArm"]].transpose(-1, -2) @ target).detach()
    fingers = torch.where(use[..., None, None], source[None][:, :, finger_ids], pose[:, :, finger_ids])
    if smoothing != "none":
        fingers = rts_smooth_rotations(fingers[0], fps=fps, gains=RTS_SMOOTHING_PRESETS[smoothing].hand)[None]
    pose[:, :, finger_ids] = fingers
    params["body_pose"] = matrix_to_rotvec(pose).reshape(1, length, 228)
    return params, geometry(params)["joints"][0]


out = {"vertexErrorMm": error_mm, "repose": repose, "smoothing": smoothing, "samSoma": {}, "joined": {}, "joinedWorld": {}}
params_incam, joints_incam = joined("pred_soma_params_incam")
params_world, joints_world = joined("pred_soma_params_global")
np.savez_compressed(
    Path(out_file).with_suffix(".npz"),
    fps=fps,
    found=found.numpy(),
    **{f"incam_{k}": v[0].numpy() for k, v in params_incam.items()},
    **{f"world_{k}": v[0].numpy() for k, v in params_world.items()},
)
index = {name: i for i, name in enumerate(public[1:])}
for key, side in (("left", "Left"), ("right", "Right")):
    ids = [index[n] for n in body_to_21(side)]
    out["samSoma"][key] = [frame.tolist() if ok else None for frame, ok in zip(sam_joints[:, ids] * 100, found)]
    out["joined"][key] = (joints_incam[:, ids] * 100).tolist()
    out["joinedWorld"][key] = (joints_world[:, ids] * 100).tolist()
with open(out_file, "w") as handle:
    json.dump(out, handle)
print(f"frames {int(found.sum())} of {len(found)}, mesh fit error {error_mm:.1f} mm, hand joints copied {len(finger_ids)} (wrist from {wrist_source}), repose {repose}, smoothing {smoothing}")
