#!/usr/bin/env python3
"""Bundle and package the phone-only ČHMÚ weather plugin, without the Pebble SDK.

The PBW layout follows coredevices/pebble-apps/scripts/pack-plugin-pbw.py:
appinfo.json (manifestVersion 2), the plugin script, and its local config page.
"""

import argparse
import copy
import hashlib
import json
from pathlib import Path
import re
import subprocess
import uuid
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?")
LICENSE_FILES = ("LICENSE", "THIRD_PARTY.md", "licenses/SunCalc-MIT.txt")


def appinfo_from_package(package):
    pebble = package.get("pebble")
    if not isinstance(pebble, dict):
        raise ValueError("package.json must contain a pebble object")
    appinfo = copy.deepcopy(pebble)
    try:
        parsed_uuid = uuid.UUID(appinfo["uuid"])
    except (KeyError, ValueError, TypeError, AttributeError) as error:
        raise ValueError("pebble.uuid must be a valid UUID") from error
    if parsed_uuid.int == 0:
        raise ValueError("pebble.uuid must not be the nil UUID")
    version = package.get("version", "")
    if not isinstance(version, str) or not VERSION.fullmatch(version):
        raise ValueError("package.version must have major.minor.patch form")
    plugin = appinfo.get("plugin")
    if not isinstance(plugin, dict) or plugin.get("script") != "plugin.js":
        raise ValueError("pebble.plugin.script must be plugin.js")
    if appinfo.get("configPage") != "config.html":
        raise ValueError("pebble.configPage must be config.html")
    if not isinstance(plugin.get("sources"), list) or not plugin["sources"]:
        raise ValueError("the plugin must declare its sources")
    for source in plugin["sources"]:
        if not isinstance(source, dict) or not source.get("category") or not source.get("items"):
            raise ValueError("every source needs a category and items")
        if not isinstance(source.get("properties"), dict) or not source["properties"]:
            raise ValueError("every source must declare property shapes")
    permissions = appinfo.get("usesPermissions")
    if not isinstance(permissions, list) or not permissions:
        raise ValueError("pebble.usesPermissions must be declared")
    for permission in permissions:
        name = permission if isinstance(permission, str) else permission.get("name") if isinstance(permission, dict) else None
        if not isinstance(name, str) or not name:
            raise ValueError("invalid permission declaration")
    display = appinfo.get("displayName") or package.get("name")
    if not isinstance(display, str) or not display:
        raise ValueError("the plugin needs a display name")
    appinfo["manifestVersion"] = 2
    appinfo.setdefault("shortName", display)
    appinfo.setdefault("longName", display)
    appinfo.setdefault("companyName", package.get("author", ""))
    appinfo["versionLabel"] = version
    appinfo.setdefault("sdkVersion", "3")
    appinfo.setdefault("resources", {"media": []})
    appinfo.setdefault("watchapp", {"watchface": False})
    if appinfo["watchapp"].get("watchface"):
        raise ValueError("this package is a phone-only plugin, not a watchface")
    return appinfo


def build_project(project=ROOT, *, run_js=True, output=None):
    project = Path(project).resolve()
    if (project / "src/c").exists():
        raise ValueError("this packager only accepts phone-only plugins (no src/c)")
    package = json.loads((project / "package.json").read_text(encoding="utf-8"))
    appinfo = appinfo_from_package(package)
    if package.get("license") == "SEE LICENSE IN LICENSE" and not (project / "LICENSE").is_file():
        raise ValueError("package.json refers to LICENSE, but that file is missing")
    if run_js:
        subprocess.run(["npm", "run", "build:js"], cwd=project, check=True)
    entries = {
        "appinfo.json": (json.dumps(appinfo, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "plugin.js": (project / "build/plugin.js").read_bytes(),
        "config.html": (project / "src/config.html").read_bytes(),
    }
    for name in LICENSE_FILES:
        path = project / name
        if path.is_file():
            entries[name] = path.read_bytes()
    if any(not content.strip() for content in entries.values()):
        raise ValueError("the plugin script, config page and included license files must not be empty")
    output = Path(output) if output else project / "dist" / f"CHMU-Weather-{package['version']}.pbw"
    output.parent.mkdir(parents=True, exist_ok=True)
    # Fixed metadata makes identical source builds reproducible.
    with zipfile.ZipFile(output, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, content in entries.items():
            entry = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            entry.compress_type = zipfile.ZIP_DEFLATED
            entry.create_system = 3
            entry.external_attr = 0o100644 << 16
            archive.writestr(entry, content)
    with zipfile.ZipFile(output) as archive:
        if archive.testzip() is not None or set(archive.namelist()) != set(entries):
            raise ValueError("the generated PBW failed integrity validation")
    return output


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", type=Path, default=ROOT)
    parser.add_argument("--skip-js-build", action="store_true", help="package an existing build/plugin.js")
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    try:
        output = build_project(args.project, run_js=not args.skip_js_build, output=args.output)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Build failed: {error}\n")
    print(f"Packaged {output}")
    print(f"SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
