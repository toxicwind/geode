"""infusion — the eval autoloader leg (python sitecustomize).

Tau's eval kernels run in an isolated python env; a `sitecustomize.py` on
their sys.path is imported automatically at interpreter boot. This file
infuses cleavage/scintillator helpers into EVERY eval kernel — the eval
analog of the BASH_ENV shim. Guarded by INFUSION_ACTIVE so nested kernels
never recurse (kairos RUN_FAST_ACTIVE doctrine).
"""
import os

if not os.environ.get("INFUSION_ACTIVE"):
    os.environ["INFUSION_ACTIVE"] = "1"
    _ROOT = os.environ.get("INFUSION_ROOT", "/home/toxic/pens/geode/products")

    def _bind(name: str, script: str):
        """Expose a product CLI through the kernel as a function."""
        def _run(*args):
            import subprocess
            cmd = ["/home/toxic/.bun/bin/bun", os.path.join(_ROOT, script), *map(str, args)]
            return subprocess.run(cmd, capture_output=True, text=True, timeout=60)
        _run.__name__ = name
        return _run

    _cleavage = os.path.join(_ROOT, "cleavage", "bin", "cleavage.ts")
    _lapidary = os.path.join(_ROOT, "lapidary", "bin", "lapidary.ts")

    if os.path.exists(_cleavage):
        cleavage = _bind("cleavage", _cleavage)  # cleavage("goniometer", "ask")
    if os.path.exists(_lapidary):
        lapidary = _bind("lapidary", _lapidary)  # lapidary("--repo", ..., "--rules", ...)
