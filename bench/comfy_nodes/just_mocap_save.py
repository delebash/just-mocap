"""Saves SAM 3D Body's per-frame MHR results to an .npz, so the GEM-X side can read the mesh and parameters.

Loaded through ComfyUI's documented extra-paths file (bench/comfy_paths.yaml, key custom_nodes), so the shared ComfyUI
install is never changed. Standard: ComfyUI's custom node format, docs.comfy.org/custom-nodes/walkthrough.
"""

import os

import numpy as np
import torch

import folder_paths

KEYS = (
    "pred_vertices", "pred_keypoints_3d", "pred_joint_coords", "pred_cam_t", "focal_length", "global_rot",
    "body_pose_params", "hand_pose_params", "shape_params", "scale_params", "expr_params", "mhr_model_params",
)


def as_array(value):
    if isinstance(value, torch.Tensor):
        value = value.detach().float().cpu().numpy()
    return np.asarray(value, dtype=np.float32)


class JustMocapSaveMHR:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"mhr_pose_data": ("MHR_POSE_DATA",), "filename_prefix": ("STRING", {"default": "mocap/mhr"})}}

    RETURN_TYPES = ()
    FUNCTION = "save"
    OUTPUT_NODE = True
    CATEGORY = "just-mocap"

    def save(self, mhr_pose_data, filename_prefix):
        frames = mhr_pose_data["frames"]
        first = next((f[0] for f in frames if f), None)
        if first is None:
            raise ValueError("no person found in any frame")
        out = {"found": np.array([bool(f) for f in frames])}
        for key in KEYS:
            if key not in first:
                continue
            shape = as_array(first[key]).shape
            out[key] = np.stack([as_array(f[0][key]) if f else np.full(shape, np.nan, np.float32) for f in frames])
        out["faces"] = np.asarray(mhr_pose_data["faces"])
        path = os.path.join(folder_paths.get_output_directory(), f"{filename_prefix}.npz")
        os.makedirs(os.path.dirname(path), exist_ok=True)
        np.savez_compressed(path, **out)
        return {}


NODE_CLASS_MAPPINGS = {"JustMocapSaveMHR": JustMocapSaveMHR}
