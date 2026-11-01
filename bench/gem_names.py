"""Prints SOMA's joint names, so GEM-X fingers can be matched to the 21 measured hand points. CPU only.
Run from the GEM-X folder with its venv: python gem_names.py assets/soma
"""

import sys

from gem.common.soma.body import SomaRuntimeConfig, _build_official_soma_runtime

config = SomaRuntimeConfig(
    data_root=sys.argv[1],
    device="cpu",
    lod="low",
    apply_correctives=False,
    enable_procedural_transforms=True,
    procedural_reference="runtime",
)
runtime = _build_official_soma_runtime(config)
names = list(runtime.rig_data["joint_names"])
print(len(names))
for index, name in enumerate(names):
    print(index, name)
