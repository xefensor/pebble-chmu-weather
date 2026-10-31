#!/usr/bin/env python3
"""Run the live source/bundled-plugin check using an allowlisted HTTPS bridge.

The bridge uses urllib so managed proxy settings apply to every request,
including installation login and refresh. No credentials are saved to disk.
Python is a development dependency only; it is not shipped in the PBW.
"""
from pathlib import Path
import os
import hashlib
import json
import zipfile
import subprocess
import sys

from build import appinfo_from_package

ROOT = Path(__file__).resolve().parents[1]


def main():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    pbw = ROOT / "dist" / ("CHMU-Weather-" + package["version"] + ".pbw")
    script = (ROOT / "build/plugin.js").read_bytes()
    with zipfile.ZipFile(pbw) as archive:
        if json.loads(archive.read("appinfo.json")) != appinfo_from_package(package):
            raise SystemExit("Packaged manifest differs from current metadata; run npm run build.")
        if archive.read("plugin.js") != script:
            raise SystemExit("Packaged JavaScript differs from the current bundle; run npm run build.")
    env = dict(os.environ)
    env["CHMU_SMOKE_PYTHON"] = sys.executable
    env["CHMU_SMOKE_BUNDLE_SHA256"] = hashlib.sha256(script).hexdigest()
    env["CHMU_SMOKE_PBW_SHA256"] = hashlib.sha256(pbw.read_bytes()).hexdigest()
    result = subprocess.run(["node", "scripts/smoke.js"], cwd=ROOT, env=env)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
