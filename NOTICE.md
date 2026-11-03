# Notices

Code copied from other projects, with its licence.

## video2mocap

- Source: https://github.com/freddysae0/video2mocap, commit 484bfc5
- Licence: Apache License 2.0, copyright the video2mocap authors
- Copied: `scripts/blender/bvh_to_fbx.py` as `bench/blender/bvh_to_fbx.py`, changed to start the FBX keys at time 0

## Kimodo

- Source: https://github.com/nv-tlabs/kimodo, commit e1c219c
- Licence: Apache License 2.0, copyright 2026 NVIDIA CORPORATION & AFFILIATES
- Adapted: the working-rig construction and SOMA settings of `kimodo/postprocess.py` (`create_working_rig_from_skeleton`, `post_process_motion`) in `bench/kimodo_feet.py`. The `MotionCorrection` package itself is built from Kimodo's source into `tmp/kimodo-mc` and not copied into this repo.
