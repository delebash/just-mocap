"""Tests for floor_plant.py, standard library unittest. Run from the GEM-X folder with its venv, where SOMA's assets are:
python ../../bench/floor_plant_test.py
The skip test needs a GEM-X result, out/gem_4648.pt (Panoptic walk 4648), and is skipped without it.
FLOOR_PLANT_DIR points the import at another copy of floor_plant.py, to see the tests fail on the old one.
"""

import os
import sys
import unittest
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, os.environ.get("FLOOR_PLANT_DIR", str(Path(__file__).parent)))
from floor_plant import plant, whittaker  # noqa: E402

GEM = Path(__file__).parent.parent / "out" / "gem_4648.pt"


class Whittaker(unittest.TestCase):
    def test_levels_off_after_the_last_contact(self):
        frames = np.arange(300)
        values = 0.001 * frames  # 3 cm a second, the size of GEM-X's drift
        weights = (frames < 100).astype(float)
        offset = whittaker(values, weights, 10.0)
        self.assertLess(np.abs(offset[:100] - values[:100]).max(), 0.002)
        # Carried on in a straight line it would rise another 0.2 m by frame 299.
        self.assertLess(offset[299] - offset[99], 0.06)
        self.assertLess(abs(offset[299] - offset[250]), 0.001)


@unittest.skipUnless(GEM.exists(), f"needs {GEM}")
class Skip(unittest.TestCase):
    def test_no_firm_contact_changes_nothing(self):
        gem = torch.load(GEM, map_location="cpu", weights_only=False)
        gem["static_conf_logits"] = torch.full_like(gem["static_conf_logits"], -10.0)
        out = plant(gem)
        self.assertTrue(out["floor_plant"]["skipped"])
        for key in ("pred_soma_params_global", "pred_soma_params_incam"):
            for name, value in gem[key].items():
                self.assertTrue(torch.equal(out[key][name], value), f"{key}.{name} changed")


if __name__ == "__main__":
    unittest.main()
