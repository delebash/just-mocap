"""Run inside Blender: blender --background --factory-startup --python bone_points.py -- <in.bvh|in.fbx> <out.json>

Imports one animation file with Blender's own importer (BVH with the settings bvh_to_fbx.py uses, FBX with defaults) and
writes every bone's head in world space for every frame, so check_import.py can compare it with the joints it came from.
"""
import json
import sys

import bpy

source, out = sys.argv[sys.argv.index("--") + 1 :][:2]
bpy.ops.wm.read_factory_settings(use_empty=True)
if source.lower().endswith(".bvh"):
    bpy.ops.import_anim.bvh(filepath=source, global_scale=1.0, frame_start=1, use_fps_scale=False, update_scene_fps=True, update_scene_duration=True, rotate_mode="NATIVE", axis_forward="-Z", axis_up="Y")
else:
    bpy.ops.import_scene.fbx(filepath=source)
arm = next(o for o in bpy.context.scene.objects if o.type == "ARMATURE")
first, last = (int(round(v)) for v in arm.animation_data.action.frame_range)
names = [bone.name for bone in arm.pose.bones]
frames = []
for frame in range(first, last + 1):
    bpy.context.scene.frame_set(frame)
    frames.append([list(arm.matrix_world @ arm.pose.bones[n].head) for n in names])
with open(out, "w") as handle:
    json.dump({"source": source, "first": first, "names": names, "frames": frames}, handle)
print(f"bone points: {len(names)} bones, frames {first}..{last}")
