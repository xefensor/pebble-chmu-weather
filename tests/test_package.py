"""The PBW contract matters: missing permission metadata makes plugins unusable."""

import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import zipfile


SCRIPT = Path(__file__).resolve().parents[1] / "scripts/build.py"
SPEC = importlib.util.spec_from_file_location("chmu_build", SCRIPT)
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)


def package():
    return {
        "name": "chmu-weather", "version": "0.1.0", "author": "Xef",
        "pebble": {
            "displayName": "ČHMÚ Weather", "uuid": "ab965015-c036-43ef-83f8-bd976e3eb626",
            "configPage": "config.html", "usesPermissions": ["Location"],
            "plugin": {
                "script": "plugin.js",
                "sources": [{"category": "weather", "items": ["location"],
                             "properties": {"temperature": ["numericValue"]}}],
            },
        },
    }


class PackageTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.project = Path(self.temp.name)
        (self.project / "src").mkdir()
        (self.project / "build").mkdir()
        (self.project / "build/plugin.js").write_text("// CHMU_BUILD_VARIANT=public\n(()=>{globalThis.pluginReady=true;})();", encoding="utf-8")
        (self.project / "src/config.html").write_text('<!doctype html><html data-build-variant="__CHMU_BUILD_VARIANT__"><title>ČHMÚ Weather</title>', encoding="utf-8")
        self.write_package(package())

    def write_package(self, value):
        (self.project / "package.json").write_text(json.dumps(value), encoding="utf-8")

    def test_plugin_only_archive_has_runtime_files_and_permission_metadata(self):
        output = BUILD.build_project(self.project, run_js=False)
        self.assertEqual(output.name, "CHMU-Weather-0.1.0.pbw")
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(archive.namelist(), ["appinfo.json", "plugin.js", "config.html"])
            self.assertIsNone(archive.testzip())
            info = json.loads(archive.read("appinfo.json"))
            self.assertEqual(info["manifestVersion"], 2)
            self.assertEqual(info["versionLabel"], "0.1.0")
            self.assertEqual(info["companyName"], "Xef")
            self.assertEqual(info["longName"], "ČHMÚ Weather")
            self.assertEqual(info["usesPermissions"], ["Location"])
            self.assertEqual(info["plugin"], package()["pebble"]["plugin"])
            self.assertFalse(info["watchapp"]["watchface"])

    def test_archive_is_deterministic(self):
        first = BUILD.build_project(self.project, run_js=False).read_bytes()
        second = BUILD.build_project(self.project, run_js=False).read_bytes()
        self.assertEqual(first, second)

    def test_public_omits_backend_permission_and_personal_has_separate_identity(self):
        source = package()
        source['pebble']['usesPermissions'].append({'name':'Internet','parameters':{'domains':['data-provider.chmi.cz','chmu.rails.cz']}})
        original = copy.deepcopy(source)
        public = BUILD.appinfo_from_package(source)
        personal = BUILD.appinfo_from_package(source, 'personal')
        self.assertNotIn('chmu.rails.cz', public['usesPermissions'][1]['parameters']['domains'])
        internet = [p for p in personal['usesPermissions'] if isinstance(p, dict) and p.get('name') == 'Internet']
        self.assertEqual(sum('chmu.rails.cz' in p['parameters']['domains'] for p in internet), 1)
        self.assertFalse(internet[-1]['required'])
        self.assertEqual(public['uuid'], source['pebble']['uuid'])
        self.assertNotEqual(personal['uuid'], public['uuid'])
        self.assertEqual(personal['displayName'], 'ČHMÚ Weather Personal')
        self.assertEqual(source, original)

    def test_variant_output_bundles_and_config_markers_are_separate(self):
        folder = self.project / 'build/personal'
        folder.mkdir()
        personal_script = b'// CHMU_BUILD_VARIANT=personal\n(()=>{})();'
        (folder / 'plugin.js').write_bytes(personal_script)
        public = BUILD.build_project(self.project, run_js=False)
        public_bytes = public.read_bytes()
        personal = BUILD.build_project(self.project, run_js=False, variant='personal')
        self.assertEqual(personal, folder / 'CHMU-Weather-0.1.0-personal.pbw')
        self.assertEqual(public.read_bytes(), public_bytes)
        for output, variant in [(public, 'public'), (personal, 'personal')]:
            with zipfile.ZipFile(output) as archive:
                self.assertIn(f'data-build-variant="{variant}"'.encode(), archive.read('config.html'))
                self.assertNotIn(b'__CHMU_BUILD_VARIANT__', archive.read('config.html'))

    def test_public_packaging_rejects_personal_or_unmarked_bundle(self):
        for script in [b'// CHMU_BUILD_VARIANT=personal\n(()=>{})();', b'(()=>{})();',
                       b'// CHMU_BUILD_VARIANT=public\nfetch("https://chmu.rails.cz/api/");']:
            (self.project / 'build/plugin.js').write_bytes(script)
            with self.assertRaisesRegex(ValueError, 'variant|backend'):
                BUILD.build_project(self.project, run_js=False)

    def test_release_candidate_filename_keeps_publishable_numeric_version(self):
        source = package()
        source.update(version="0.6.0", releaseCandidate=1)
        self.write_package(source)
        output = BUILD.build_project(self.project, run_js=False)
        self.assertEqual(output.name, "CHMU-Weather-0.6.0-rc.1.pbw")
        with zipfile.ZipFile(output) as archive:
            info = json.loads(archive.read("appinfo.json"))
            self.assertEqual(info["versionLabel"], "0.6.0")
            self.assertNotIn("releaseCandidate", info)

    def test_unpublishable_version_or_invalid_candidate_is_rejected(self):
        for version in ["0.6.0-rc.1", "256.1.0", "1.256.0", "1.0.256"]:
            with self.subTest(version=version):
                source = package()
                source["version"] = version
                with self.assertRaises(ValueError): BUILD.appinfo_from_package(source)
        for candidate in [True, False, 0, -1, "1", None]:
            with self.subTest(candidate=candidate):
                source = package()
                source["releaseCandidate"] = candidate
                self.write_package(source)
                with self.assertRaises(ValueError): BUILD.build_project(self.project, run_js=False)

    def test_shipped_license_and_attribution_files_preserve_exact_bytes(self):
        files = {
            "LICENSE": b"License terms\r\nCopyright Xef\r\n",
            "THIRD_PARTY.md": "ČHMÚ attribution\nSunCalc\n".encode("utf-8"),
            "licenses/SunCalc-MIT.txt": b"MIT License\nCopyright Vladimir Agafonkin\n",
        }
        for name, content in files.items():
            path = self.project / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(content)
        source = package()
        source["license"] = "SEE LICENSE IN LICENSE"
        self.write_package(source)
        output = BUILD.build_project(self.project, run_js=False)
        original = output.read_bytes()
        with zipfile.ZipFile(output) as archive:
            self.assertEqual(set(archive.namelist()), {"appinfo.json", "plugin.js", "config.html", *files})
            for name, content in files.items():
                self.assertEqual(archive.read(name), content)
        self.assertEqual(BUILD.build_project(self.project, run_js=False).read_bytes(), original)

    def test_missing_explicitly_referenced_license_is_rejected(self):
        source = package()
        source["license"] = "SEE LICENSE IN LICENSE"
        self.write_package(source)
        with self.assertRaisesRegex(ValueError, "LICENSE.*missing"):
            BUILD.build_project(self.project, run_js=False)

    def test_empty_license_file_is_rejected(self):
        (self.project / "LICENSE").write_bytes(b"")
        with self.assertRaisesRegex(ValueError, "license files must not be empty"):
            BUILD.build_project(self.project, run_js=False)

    def test_packaging_does_not_mutate_source_manifest(self):
        original = package()
        saved = copy.deepcopy(original)
        BUILD.appinfo_from_package(original)
        self.assertEqual(original, saved)

    def test_bad_uuid_or_version_is_rejected(self):
        for field, value in [("uuid", "invalid"), ("uuid", "00000000-0000-0000-0000-000000000000")]:
            with self.subTest(field=field, value=value):
                p = package()
                p["pebble"][field] = value
                with self.assertRaises(ValueError): BUILD.appinfo_from_package(p)
        p = package()
        p["version"] = "../outside"
        with self.assertRaises(ValueError): BUILD.appinfo_from_package(p)

    def test_missing_permissions_and_source_shapes_are_rejected(self):
        for change in [lambda p: p["pebble"].pop("usesPermissions"),
                       lambda p: p["pebble"].update(usesPermissions=[{}]),
                       lambda p: p["pebble"]["plugin"].update(sources=[]),
                       lambda p: p["pebble"]["plugin"]["sources"][0].update(properties={})]:
            p = package()
            change(p)
            with self.assertRaises(ValueError): BUILD.appinfo_from_package(p)

    def test_paths_cannot_escape_the_archive_or_replace_the_manifest(self):
        for path in ["../plugin.js", "/plugin.js", "appinfo.json"]:
            p = package()
            p["pebble"]["plugin"]["script"] = path
            with self.assertRaises(ValueError): BUILD.appinfo_from_package(p)

    def test_remote_or_missing_settings_page_is_rejected(self):
        p = package()
        p["pebble"]["configPage"] = "https://example.com/config.html"
        with self.assertRaises(ValueError): BUILD.appinfo_from_package(p)
        (self.project / "src/config.html").unlink()
        with self.assertRaises(FileNotFoundError): BUILD.build_project(self.project, run_js=False)

    def test_missing_or_empty_bundle_is_rejected(self):
        script = self.project / "build/plugin.js"
        script.write_text("", encoding="utf-8")
        with self.assertRaises(ValueError): BUILD.build_project(self.project, run_js=False)
        script.unlink()
        with self.assertRaises(FileNotFoundError): BUILD.build_project(self.project, run_js=False)

    def test_watch_binary_project_is_rejected(self):
        (self.project / "src/c").mkdir()
        with self.assertRaises(ValueError): BUILD.build_project(self.project, run_js=False)


if __name__ == "__main__":
    unittest.main()
