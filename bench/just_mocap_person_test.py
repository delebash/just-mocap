"""Tests for the ComfyUI node comfy_nodes/just_mocap_person.py, standard library unittest, no ComfyUI needed.
Run with any Python: python bench/just_mocap_person_test.py
"""

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "comfy_nodes"))
from just_mocap_person import JustMocapPersonBoxes, pick  # noqa: E402


def box(x0, y0, x1, y1, score):
    return {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "label": "person", "score": score}


PASSER_BY = box(0, 0, 100, 300, 0.95)
GUITARIST = box(400, 100, 520, 400, 0.80)


class Pick(unittest.TestCase):
    def test_keeps_gem_x_person_when_another_scores_higher(self):
        kept, counts = pick([[PASSER_BY, GUITARIST]], [[405, 110, 515, 395]])
        self.assertEqual(kept, [[GUITARIST]])
        self.assertEqual(counts["another box"], 1)

    def test_top_box_counted_as_such(self):
        kept, counts = pick([[GUITARIST]], [[400, 100, 520, 400]])
        self.assertEqual(kept, [[GUITARIST]])
        self.assertEqual(counts["top box"], 1)

    def test_no_box_when_nothing_overlaps_enough(self):
        # Overlap 0.33 with the only box, under 0.5: another person standing in front is not taken.
        kept, counts = pick([[box(0, 0, 100, 100, 0.9)]], [[50, 0, 150, 100]])
        self.assertEqual(kept, [[]])
        self.assertEqual(counts["none"], 1)

    def test_no_box_without_detections_or_reference(self):
        kept, _ = pick([[], [GUITARIST]], [[400, 100, 520, 400], None])
        self.assertEqual(kept, [[], []])

    def test_frame_counts_must_agree(self):
        with self.assertRaises(ValueError):
            pick([[GUITARIST]], [])

    def test_node_reads_json_and_rt_detr_layout(self):
        (kept,) = JustMocapPersonBoxes().run([[PASSER_BY, GUITARIST], [GUITARIST]], "[[405, 110, 515, 395], [400, 100, 520, 400]]")
        self.assertEqual(kept, [[GUITARIST], [GUITARIST]])


if __name__ == "__main__":
    unittest.main()
