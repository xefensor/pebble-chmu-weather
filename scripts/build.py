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
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
LICENSE_FILES = ("LICENSE", "THIRD_PARTY.md", "licenses/SunCalc-MIT.txt")
VARIANTS = ("public", "personal")
APP_DOMAIN = "chmu.rails.cz"


def appinfo_from_package(package, variant="public"):
    if variant not in VARIANTS:
        raise ValueError("variant must be public or personal")
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
    if (not isinstance(version, str) or not VERSION.fullmatch(version) or
            any(int(part) > 255 for part in version.split('.'))):
        raise ValueError("package.version must be numeric major.minor.patch with segments at most 255")
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
    # Public upgrades keep the original identity. Personal installs have their
    # own provider/settings namespace and cannot replace a Store installation.
    for permission in permissions:
        if isinstance(permission, dict) and permission.get("name") == "Internet":
            domains = permission.setdefault("parameters", {}).setdefault("domains", [])
            permission["parameters"]["domains"] = [d for d in domains if d != APP_DOMAIN]
            if variant == "personal":
                permission["parameters"]["domains"].append(APP_DOMAIN)
    if variant == "personal":
        appinfo["uuid"] = str(uuid.uuid5(parsed_uuid, "personal-build"))
        display += " Personal"
        appinfo["displayName"] = display
        appinfo["shortName"] = display
        appinfo["longName"] = display
        plugin["description"] = ("Personal build: ČHMÚ public weather plus optional app-service "
                                 "full-day forecasts and clear-sky noon UV. Not for Store distribution.")
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


def artifact_stem(package, variant="public"):
    if variant not in VARIANTS:
        raise ValueError("variant must be public or personal")
    suffix = ""
    if "releaseCandidate" in package:
        candidate = package["releaseCandidate"]
        if not isinstance(candidate, int) or isinstance(candidate, bool) or candidate < 1:
            raise ValueError("releaseCandidate must be a positive integer")
        suffix = f"-rc.{candidate}"
    personal = "-personal" if variant == "personal" else ""
    return f"CHMU-Weather-{package['version']}{suffix}{personal}"


def build_project(project=ROOT, *, run_js=True, output=None, variant="public"):
    project = Path(project).resolve()
    if (project / "src/c").exists():
        raise ValueError("this packager only accepts phone-only plugins (no src/c)")
    package = json.loads((project / "package.json").read_text(encoding="utf-8"))
    appinfo = appinfo_from_package(package, variant)
    stem = artifact_stem(package, variant)
    bundle_dir = project / "build" / "personal" if variant == "personal" else project / "build"
    if package.get("license") == "SEE LICENSE IN LICENSE" and not (project / "LICENSE").is_file():
        raise ValueError("package.json refers to LICENSE, but that file is missing")
    if run_js:
        subprocess.run(["npm", "run", "build:js", "--", "--variant", variant], cwd=project, check=True)
    script = (bundle_dir / "plugin.js").read_bytes()
    marker = f"// CHMU_BUILD_VARIANT={variant}\n".encode()
    if not script.startswith(marker):
        raise ValueError("bundle build variant does not match; rebuild JavaScript for the selected variant")
    if variant == "public" and APP_DOMAIN.encode() in script:
        raise ValueError("public bundle must not contain the app backend")
    entries = {
        "appinfo.json": (json.dumps(appinfo, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        "plugin.js": script,
        "config.html": (project / "src/config.html").read_bytes().replace(b"__CHMU_BUILD_VARIANT__", variant.encode()),
    }
    for name in LICENSE_FILES:
        path = project / name
        if path.is_file():
            entries[name] = path.read_bytes()
    if any(not content.strip() for content in entries.values()):
        raise ValueError("the plugin script, config page and included license files must not be empty")
    output = Path(output) if output else (bundle_dir if variant == "personal" else project / "dist") / f"{stem}.pbw"
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
    parser.add_argument("--variant", choices=VARIANTS, default="public")
    args = parser.parse_args()
    try:
        output = build_project(args.project, run_js=not args.skip_js_build, output=args.output, variant=args.variant)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Build failed: {error}\n")
    print(f"Packaged {output}")
    print(f"SHA256 {hashlib.sha256(output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    main()
