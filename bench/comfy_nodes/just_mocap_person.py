"""Keeps, in each frame, only the detector box of the person GEM-X captures, so SAM 3D Body's fingers belong to GEM-X's
body (mocap.js, the user's go of 2026-11-05). Without it SAM 3D Body takes RT-DETR's highest-scoring box, which can jump
to another person (the guitarist clip: 3.2 m jumps to passers-by, RESEARCH.md 2026-11-04).

For each frame, the RT-DETR box that overlaps GEM-X's own box for its person most (intersection over union) is kept when
the overlap is 0.5 or more, the standard detection-match threshold (PASCAL VOC, COCO's AP50). A frame with no such box gets
none: SAM 3D Body skips it, and join_fingers.py keeps GEM-X's own hands there.

Used instead of ComfyUI's template, which tracks people with SAM 3.1 (utility_sam3d_body.json): GEM-X has already chosen
and followed the person, and with tracking SAM 3D Body runs on every tracked person in every frame (4x the time on the
guitarist). Loaded like just_mocap_save.py, through bench/comfy_paths.yaml. Standard: ComfyUI's custom node format,
docs.comfy.org/custom-nodes/walkthrough.
"""

import json

MATCH = 0.5


def overlap(a, b):
    """Intersection over union of two [x0, y0, x1, y1] boxes."""
    width = min(a[2], b[2]) - max(a[0], b[0])
    height = min(a[3], b[3]) - max(a[1], b[1])
    if width <= 0 or height <= 0:
        return 0.0
    inter = width * height
    return inter / ((a[2] - a[0]) * (a[3] - a[1]) + (b[2] - b[0]) * (b[3] - b[1]) - inter)


def pick(detections, reference):
    """detections: per frame, RT-DETR's box dicts (x, y, width, height, score, label). reference: per frame, GEM-X's
    [x0, y0, x1, y1] or None. Returns per frame a list holding the matching box, or an empty list, and counts."""
    if len(detections) != len(reference):
        raise ValueError(f"{len(detections)} frames of detections, {len(reference)} of GEM-X boxes")
    out, counts = [], {"top box": 0, "another box": 0, "none": 0}
    for boxes, target in zip(detections, reference):
        scored = [(overlap([d["x"], d["y"], d["x"] + d["width"], d["y"] + d["height"]], target), i) for i, d in enumerate(boxes)] if target else []
        best, index = max(scored, default=(0.0, -1))
        if best < MATCH:
            out.append([])
            counts["none"] += 1
            continue
        out.append([boxes[index]])
        counts["top box" if index == max(range(len(boxes)), key=lambda i: boxes[i].get("score", 0)) else "another box"] += 1
    return out, counts


class JustMocapPersonBoxes:
    @classmethod
    def INPUT_TYPES(cls):
        return {"required": {"bboxes": ("BOUNDING_BOX",), "person": ("STRING", {"multiline": True, "default": "[]"})}}

    RETURN_TYPES = ("BOUNDING_BOX",)
    FUNCTION = "run"
    CATEGORY = "just-mocap"

    def run(self, bboxes, person):
        reference = json.loads(person)
        detections = [[bboxes]] if isinstance(bboxes, dict) else [bboxes] if bboxes and isinstance(bboxes[0], dict) else list(bboxes)
        kept, counts = pick(detections, reference)
        print(f"JustMocapPersonBoxes: {len(kept)} frames; GEM-X's person was RT-DETR's top box in {counts['top box']}, another box in {counts['another box']}, not found in {counts['none']}")
        return (kept,)


NODE_CLASS_MAPPINGS = {"JustMocapPersonBoxes": JustMocapPersonBoxes}
