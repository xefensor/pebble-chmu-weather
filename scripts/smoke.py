#!/usr/bin/env python3
"""Check the exact packaged variant using an allowlisted live HTTPS bridge.

The public default cannot request the app backend. Only an explicit personal
variant runs installation login and refresh. The urllib bridge honors managed
proxy settings. No credentials are saved to disk.
Python is a development dependency only; it is not shipped in the PBW.
"""
from pathlib import Path
import argparse
import os
import hashlib
import json
import zipfile
import subprocess
import sys

from build import appinfo_from_package, artifact_stem

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--variant", choices=("public", "personal"), default="public")
    args = parser.parse_args()
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    directory = ROOT / ("build/personal" if args.variant == "personal" else "dist")
    pbw = directory / (artifact_stem(package, variant=args.variant) + ".pbw")
    script_path = ROOT / ("build/personal/plugin.js" if args.variant == "personal" else "build/plugin.js")
    script = script_path.read_bytes()
    manifest = appinfo_from_package(package, variant=args.variant)
    with zipfile.ZipFile(pbw) as archive:
        if json.loads(archive.read("appinfo.json")) != manifest:
            raise SystemExit("Packaged manifest differs from current metadata; run npm run build.")
        if archive.read("plugin.js") != script:
            raise SystemExit("Packaged JavaScript differs from the current bundle; run npm run build.")
    env = dict(os.environ)
    env["CHMU_SMOKE_PYTHON"] = sys.executable
    env["CHMU_SMOKE_BUNDLE_SHA256"] = hashlib.sha256(script).hexdigest()
    env["CHMU_SMOKE_PBW_SHA256"] = hashlib.sha256(pbw.read_bytes()).hexdigest()
    env["CHMU_SMOKE_VARIANT"] = args.variant
    env["CHMU_SMOKE_SCRIPT_PATH"] = str(script_path)
    env["CHMU_SMOKE_MANIFEST"] = json.dumps(manifest)
    runner = "scripts/smoke.js" if args.variant == "personal" else "scripts/smoke-public.js"
    result = subprocess.run(["node", runner], cwd=ROOT, env=env)
    return result.returncode


if __name__ == "__main__":
    raise SystemExit(main())
