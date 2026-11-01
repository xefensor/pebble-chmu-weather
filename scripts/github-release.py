#!/usr/bin/env python3
"""Validate committed release artifacts and publish them without rebuilding or replacing assets."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import tempfile
import zipfile


ROOT = Path(__file__).resolve().parents[1]
VERSION = re.compile(r"[0-9]+\.[0-9]+\.[0-9]+")
SHA = re.compile(r"[a-f0-9]{40}")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def digest(content):
    return hashlib.sha256(content).hexdigest()


def safe_path(value):
    require(isinstance(value, str) and value and "\\" not in value and ":" not in value,
            "Invalid repository path")
    path = PurePosixPath(value)
    require(not path.is_absolute() and ".." not in path.parts and str(path) == value,
            "Unsafe repository path: " + value)
    return value


def git(root, *args):
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True)
    require(result.returncode == 0, "Cannot read committed release input: " + " ".join(args[:2]))
    return result.stdout


def committed(root, commit, path):
    return git(root, "show", commit + ":" + safe_path(path))


def release_id(package):
    version = package.get("version")
    require(isinstance(version, str) and VERSION.fullmatch(version) and
            all(int(part) <= 255 for part in version.split(".")), "Invalid package version")
    qualifiers = [(name, package[name]) for name in
                  ("halftoneReleaseCandidate", "halftoneBeta", "releaseCandidate") if name in package]
    require(len(qualifiers) <= 1, "Multiple prerelease counters")
    if qualifiers:
        name, number = qualifiers[0]
        require(type(number) is int and number > 0, "Invalid prerelease counter")
        return version + ("-beta." if name == "halftoneBeta" else "-rc.") + str(number)
    return version


def expand(value, package):
    return safe_path(value.format(version=package["version"], release_id=release_id(package)))


def zip_files(content):
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        require(archive.testzip() is None, "Corrupt ZIP artifact")
        entries = [entry for entry in archive.infolist() if not entry.is_dir()]
        require(len(entries) == len({entry.filename for entry in entries}), "Duplicate ZIP member")
        require(sum(entry.file_size for entry in entries) <= 256 * 1024 * 1024,
                "ZIP artifact exceeds validation budget")
        for entry in entries:
            safe_path(entry.filename)
            require((entry.external_attr >> 16) & 0o170000 != 0o120000, "ZIP symlink is not supported")
        return {entry.filename: archive.read(entry) for entry in entries}


def critical(path):
    return path.startswith(("src/", "resources/", "vendor/", "include/", "licenses/")) or path in {
        "package.json", "package-lock.json", "wscript", "LICENSE", "THIRD-PARTY-NOTICES.md",
        "THIRD_PARTY.md", "scripts/build.py", "scripts/build-js.js", "scripts/package-release.py",
        "scripts/package-source.py", "scripts/release_licenses.py"}


def validate_source(root, commit, source, prefix=""):
    files = zip_files(source)
    if prefix:
        safe_path(prefix.rstrip("/"))
        require(prefix.endswith("/") and all(name.startswith(prefix) for name in files),
                "Unexpected source archive prefix")
        files = {name[len(prefix):]: content for name, content in files.items()}
    names = git(root, "ls-tree", "-r", "--name-only", "-z", commit).decode().split("\0")
    for path in names:
        if path and critical(path):
            require(path in files, "Source archive omits build input: " + path)
    for path, content in files.items():
        if critical(path):
            require(content == committed(root, commit, path), "Stale source archive input: " + path)
    return files


def checksum_map(content, asset_paths, checksums_path):
    result = {}
    for line in content.decode().splitlines():
        match = re.fullmatch(r"([a-f0-9]{64}) [ *](.+)", line)
        require(match, "Invalid checksum line")
        name = safe_path(match[2])
        require(name not in result, "Duplicate checksum entry: " + name)
        result[name] = match[1]
    selected = {}
    for path in asset_paths:
        candidates = [key for key in (path, str(PurePosixPath(path).relative_to(
            PurePosixPath(checksums_path).parent)) if
            PurePosixPath(checksums_path).parent in PurePosixPath(path).parents else "") if key in result]
        require(candidates and len({result[key] for key in candidates}) == 1,
                "Missing or ambiguous checksum: " + path)
        selected[path] = result[candidates[0]]
    return selected


def validate_artifacts(root, config, commit, package, assets):
    kind = config["kind"]
    if kind == "core":
        packed = [data for path, data in assets.items() if path.endswith(".tgz")]
        require(len(packed) == 1 and "dist.zip" in assets, "Expected one Core tarball and dist.zip")
        with tarfile.open(fileobj=io.BytesIO(packed[0]), mode="r:gz") as archive:
            members = archive.getmembers()
            require(all(member.isfile() and member.name.startswith("package/") for member in members),
                    "Unsafe Core tarball member")
            require(len(members) == len({member.name for member in members}), "Duplicate Core member")
            files = {safe_path(member.name[8:]): archive.extractfile(member).read() for member in members}
        require(files.get("dist.zip") == assets["dist.zip"], "Core tarball contains another SDK package")
        require(json.loads(files["package.json"])["version"] == package["version"], "Core tar version differs")
        for path, content in files.items():
            if critical(path):
                require(content == committed(root, commit, path), "Stale Core tar input: " + path)
        names = git(root, "ls-tree", "-r", "--name-only", "-z", commit).decode().split("\0")
        for path in names:
            if path.startswith(("src/", "include/")):
                require(path in files, "Core tarball omits source: " + path)
        sdk = zip_files(assets["dist.zip"])
        for path, content in files.items():
            if path.startswith("src/js/"):
                require(sdk.get("js/" + path[7:]) == content, "Core SDK JavaScript differs: " + path)
            elif path.startswith("include/") and path.endswith(".h"):
                require(sdk.get("include/pebble-watchface-core/" + path[8:]) == content,
                        "Core SDK exported header differs: " + path)
        return
    source_config = config["source_archive"]
    source_path = expand(source_config["path"], package)
    source = validate_source(root, commit, assets[source_path], source_config.get("prefix", ""))
    require(json.loads(source["package.json"]) == package, "Source package metadata differs")
    pbws = [(path, data) for path, data in assets.items() if path.endswith(".pbw")]
    require(len(pbws) == 1, "Expected exactly one public PBW")
    pbw_path, pbw_data = pbws[0]
    pbw = zip_files(pbw_data)
    info = json.loads(pbw["appinfo.json"])
    require(info.get("uuid") == config["app_uuid"] == package["pebble"]["uuid"] and
            info.get("versionLabel") == package["version"], "PBW identity/version differs")
    if kind == "chmu":
        require(info.get("plugin", {}).get("script") == "plugin.js" and
                pbw["plugin.js"].startswith(b"// CHMU_BUILD_VARIANT=public\n"), "Not a public CHMU build")
        require(b"chmu.rails.cz" not in pbw["plugin.js"] and
                "chmu.rails.cz" not in json.dumps(info), "Personal CHMU backend in public PBW")
        require(b'data-build-variant="public"' in pbw["config.html"] and
                pbw["config.html"] == source["src/config.html"].replace(b"__CHMU_BUILD_VARIANT__", b"public"),
                "CHMU configuration is not the public source build")
    else:
        require(info.get("watchapp", {}).get("watchface") is True, "Not a watchface PBW")
        mapping = json.loads(pbw["pebble-js-app.js.map"])
        require(len(mapping["sources"]) == len(mapping["sourcesContent"]), "Invalid PBW source map")
        mapped = 0
        for path, text in zip(mapping["sources"], mapping["sourcesContent"]):
            if path.startswith("./src/"):
                original = source[path[2:]].decode()
                tail = text[len(original):]
                require(text.startswith(original) and (not tail or re.fullmatch(
                    r"\n{2,}//////////////////\n// WEBPACK FOOTER(?:\n//[^\n]*)*\s*", tail)),
                    "PBW JavaScript/source differs: " + path)
                mapped += 1
        require(mapped > 0, "PBW has no application source mapping")
    for path, content in assets.items():
        if path.endswith(("-store-package.zip", "-store-release.zip")):
            store = zip_files(content)
            embedded = [name for name in store if name.endswith(".pbw")]
            require(embedded == [PurePosixPath(pbw_path).name] and store[embedded[0]] == pbw_data,
                    "Store archive embeds a different or additional PBW")


def prepare(root, config_path, output, trigger_commit=None):
    config = json.loads(config_path.read_text())
    require(config["kind"] in ("watchface", "core", "chmu"), "Unsupported release kind")
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", config["repository"]), "Invalid repository")
    require(type(config["prerelease"]) is bool and config["display_name"], "Invalid release metadata")
    trigger = trigger_commit or git(root, "rev-parse", "HEAD").decode().strip()
    require(SHA.fullmatch(trigger), "Release commit must be a full SHA")
    package = json.loads(committed(root, trigger, "package.json"))
    identity = release_id(package)
    require(config["prerelease"] or not re.search(r"-(?:rc|beta)\.", identity),
            "Release candidates and betas must be marked prerelease")
    bootstrap = config.get("bootstrap", {})
    commit = bootstrap.get("source_commit") if bootstrap.get("version") == identity else trigger
    require(isinstance(commit, str) and SHA.fullmatch(commit), "Invalid source commit")
    require(subprocess.run(["git", "-C", str(root), "merge-base", "--is-ancestor", commit, trigger],
                           capture_output=True).returncode == 0, "Source commit is not an ancestor")
    original_package = json.loads(committed(root, commit, "package.json"))
    require(release_id(original_package) == identity, "Bootstrap package version differs")
    paths = [expand(path, package) for path in config["assets"]]
    require(paths and len(paths) <= 8 and len(paths) == len(set(paths)) and
            len({PurePosixPath(path).name for path in paths}) == len(paths), "Duplicate release assets")
    require(all(re.fullmatch(r"[A-Za-z0-9_.-]+", PurePosixPath(path).name) for path in paths),
            "Unsafe asset basename")
    checksums_path = safe_path(config["checksums_file"])
    expected = checksum_map(committed(root, commit, checksums_path), paths, checksums_path)
    current = checksum_map(committed(root, trigger, checksums_path), paths, checksums_path)
    assets = {}
    for path in paths:
        content = committed(root, commit, path)
        require(content == committed(root, trigger, path),
                "An existing version's asset changed; restore it or bump the version: " + path)
        require(digest(content) == expected[path] == current[path], "Artifact checksum differs: " + path)
        assets[path] = content
    validate_artifacts(root, config, commit, original_package, assets)
    tag = config.get("tag_prefix", "v") + identity
    require(re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", tag), "Unsafe release tag")
    note_config = config["notes"]
    notes = committed(root, commit, expand(note_config["path"], package)).decode().strip()
    if note_config.get("heading"):
        heading = note_config["heading"].format(version=package["version"], release_id=identity)
        match = re.search(r"^" + re.escape(heading) + r"\s*\n(.*?)(?=^##\s|\Z)", notes, re.M | re.S)
        require(match, "Release notes heading is missing")
        notes = match.group(1).strip()
    require(notes, "Release notes are empty")
    output.mkdir(parents=True, exist_ok=True)
    records = []
    for path, content in assets.items():
        name = PurePosixPath(path).name
        (output / name).write_bytes(content)
        records.append({"name": name, "repository_path": path, "sha256": digest(content), "bytes": len(content)})
    checksum_bytes = "".join(item["sha256"] + "  " + item["name"] + "\n" for item in records).encode()
    require("SHA256SUMS.txt" not in [item["name"] for item in records], "Reserved checksum asset name")
    (output / "SHA256SUMS.txt").write_bytes(checksum_bytes)
    records.append({"name": "SHA256SUMS.txt", "sha256": digest(checksum_bytes), "bytes": len(checksum_bytes)})
    notes += "\n\nSource: https://github.com/" + config["repository"] + "/tree/" + commit
    notes += "\n\nDownload the files below together with SHA256SUMS.txt to verify their integrity.\n"
    (output / "release-notes.md").write_text(notes)
    manifest = {"repository": config["repository"], "display_name": config["display_name"],
                "version": package["version"], "release_id": identity, "tag": tag,
                "prerelease": config["prerelease"], "source_commit": commit,
                "trigger_commit": trigger, "assets": records}
    (output / "release-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
    return manifest


class GitHub:
    def __init__(self, repository):
        self.repository = repository

    def api(self, method, path, data=None, missing=False):
        command = ["gh", "api", "repos/" + self.repository + "/" + path, "--method", method]
        if data is not None:
            command += ["--input", "-"]
        result = subprocess.run(command, input=json.dumps(data).encode() if data is not None else None,
                                capture_output=True)
        status = re.search(rb"\bHTTP\s*([0-9]{3})\b", result.stderr)
        if missing and result.returncode and status and status.group(1) == b"404":
            return None
        detail = " (HTTP " + status.group(1).decode() + ")" if status else ""
        hint = next((line for line in result.stderr.decode(errors="replace").splitlines()
                     if line.startswith("gh:")), "")
        for key in ("GH_TOKEN", "GITHUB_TOKEN"):
            if os.getenv(key):
                hint = hint.replace(os.environ[key], "[redacted]")
        require(result.returncode == 0, "GitHub request failed" + detail + ": " + method + " " + path +
                ("; " + hint[:300] if hint else ""))
        return json.loads(result.stdout) if result.stdout.strip() else None

    def release(self, tag):
        return self.api("GET", "releases/tags/" + tag, missing=True)

    def tag_commit(self, tag):
        ref = self.api("GET", "git/ref/tags/" + tag, missing=True)
        if ref is None:
            return None
        obj = ref["object"]
        for _ in range(10):
            if obj["type"] == "commit":
                return obj["sha"]
            require(obj["type"] == "tag", "Tag does not resolve to a commit")
            obj = self.api("GET", "git/tags/" + obj["sha"])["object"]
        raise ValueError("Annotated tag chain is too long")

    def create_tag(self, tag, commit):
        self.api("POST", "git/refs", {"ref": "refs/tags/" + tag, "sha": commit})

    def create_release(self, manifest, notes):
        return self.api("POST", "releases", {"tag_name": manifest["tag"],
            "target_commitish": manifest["source_commit"], "draft": True,
            "prerelease": manifest["prerelease"], "name": manifest["display_name"] + " " + manifest["release_id"],
            "body": notes})

    def assets(self, release):
        return self.api("GET", "releases/" + str(release["id"]) + "/assets?per_page=100")

    def verify_asset(self, release, asset, expected):
        require(asset["size"] == expected["bytes"], "Published asset size differs: " + expected["name"])
        actual_digest = asset.get("digest")
        if actual_digest:
            require(actual_digest == "sha256:" + expected["sha256"],
                    "Published asset hash differs: " + expected["name"])
        else:
            with tempfile.TemporaryDirectory(prefix="verify-gh-release-") as folder:
                result = subprocess.run(["gh", "release", "download", release["tag_name"], "--repo",
                    self.repository, "--pattern", expected["name"], "--dir", folder], capture_output=True)
                require(result.returncode == 0, "Cannot verify legacy release asset")
                require(digest((Path(folder) / expected["name"]).read_bytes()) == expected["sha256"],
                        "Published asset hash differs: " + expected["name"])

    def upload(self, tag, path):
        result = subprocess.run(["gh", "release", "upload", tag, str(path), "--repo", self.repository],
                                capture_output=True)
        require(result.returncode == 0, "Cannot upload release asset: " + path.name)

    def publish(self, release, prerelease):
        return self.api("PATCH", "releases/" + str(release["id"]),
                        {"draft": False, "prerelease": prerelease,
                         "make_latest": "false" if prerelease else "legacy"})


def publish(root, folder, github=None):
    manifest = json.loads((folder / "release-manifest.json").read_text())
    require(re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", manifest["repository"]), "Invalid repository")
    require(not os.getenv("GITHUB_REPOSITORY") or os.environ["GITHUB_REPOSITORY"] == manifest["repository"],
            "Release repository differs from this workflow")
    require(SHA.fullmatch(manifest["source_commit"]) and
            re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]*", manifest["tag"]), "Invalid release target")
    require(type(manifest["prerelease"]) is bool and (manifest["prerelease"] or
            not re.search(r"-(?:rc|beta)\.", manifest["release_id"])), "Invalid prerelease policy")
    expected = {}
    for item in manifest["assets"]:
        name = safe_path(item["name"])
        require(PurePosixPath(name).name == name and name not in expected, "Duplicate/unsafe release filename")
        content = (folder / name).read_bytes()
        require(len(content) == item["bytes"] and digest(content) == item["sha256"],
                "Prepared asset changed: " + name)
        expected[name] = item
    github = github or GitHub(manifest["repository"])
    release = github.release(manifest["tag"])
    tag_commit = github.tag_commit(manifest["tag"])
    if release and not release["draft"]:
        require(tag_commit, "Published release has no tag")
        require(release["prerelease"] == manifest["prerelease"], "Published release prerelease flag differs")
        package = json.loads(committed(root, tag_commit, "package.json"))
        require(release_id(package) == manifest["release_id"], "Published tag has another package version")
        for item in manifest["assets"]:
            if "repository_path" in item:
                require(digest(committed(root, tag_commit, item["repository_path"])) == item["sha256"],
                        "Published tag contains a different artifact")
    else:
        require(tag_commit is None or tag_commit == manifest["source_commit"],
                "Existing tag points elsewhere; tags are never moved")
    existing = github.assets(release) if release else []
    by_name = {item["name"]: item for item in existing}
    require(len(by_name) == len(existing) and set(by_name) <= set(expected), "Unexpected existing release assets")
    for name, item in by_name.items():
        github.verify_asset(release, item, expected[name])
    if release and not release["draft"]:
        require(set(by_name) == set(expected), "Published release is incomplete; assets will not be replaced")
        return "unchanged"
    if tag_commit is None:
        github.create_tag(manifest["tag"], manifest["source_commit"])
    if release is None:
        release = github.create_release(manifest, (folder / "release-notes.md").read_text())
    for name in expected:
        if name not in by_name:
            github.upload(manifest["tag"], folder / name)
    uploaded = github.assets(release)
    require(len(uploaded) == len(expected) and {item["name"] for item in uploaded} == set(expected),
            "Release asset upload is incomplete")
    for item in uploaded:
        github.verify_asset(release, item, expected[item["name"]])
    github.publish(release, manifest["prerelease"])
    return "published"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("prepare", "publish"))
    parser.add_argument("--config", type=Path, default=ROOT / ".github/release.json")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--commit", help="Full triggering commit SHA; defaults to HEAD")
    args = parser.parse_args()
    if args.command == "prepare":
        manifest = prepare(ROOT, args.config, args.output, args.commit)
        if os.getenv("GITHUB_OUTPUT"):
            with open(os.environ["GITHUB_OUTPUT"], "a") as handle:
                handle.write("release_id=" + manifest["release_id"] + "\n")
        print("Prepared " + manifest["tag"] + " from " + manifest["source_commit"])
    else:
        print("GitHub release: " + publish(ROOT, args.output))


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, OSError, zipfile.BadZipFile, tarfile.TarError) as error:
        raise SystemExit("Release failed: " + str(error))
