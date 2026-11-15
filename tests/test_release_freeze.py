"""The release freezer must preserve reviewed bytes and historical versions."""
from pathlib import Path
import importlib.util,json,shutil,subprocess,sys,tempfile,unittest,zipfile
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'));sys.path.insert(0,str(ROOT/'tests'))
from test_store_kit import fixture,package,kit
spec=importlib.util.spec_from_file_location('freeze_release',ROOT/'scripts/freeze-release.py')
release=importlib.util.module_from_spec(spec);spec.loader.exec_module(release)
class ReleaseFreeze(unittest.TestCase):
    def setup_candidate(self,root):
        subprocess.run(['git','init','-q',str(root)],check=True)
        files=fixture(root);listing=json.loads((root/'store/listing.json').read_text());listing['artifact_stem']='Weather';(root/'store/listing.json').write_text(json.dumps(listing))
        pbw=package(root,files);(root/'build/candidate').mkdir(parents=True);pbw=pbw.rename(root/'build/candidate/Weather-1.2.3.pbw')
        (root/'scripts').mkdir();shutil.copyfile(ROOT/'scripts/store-kit.py',root/'scripts/store-kit.py')
        entries,_=kit.payload(root,pbw);(root/'build/store').mkdir(parents=True)
        (root/'build/store/Weather-1.2.3-store-package.zip').write_bytes(release.zipped(entries))
        (root/'README.md').write_text('Current source')
        return pbw
    def test_exact_checked_bytes_source_and_old_checksums_are_preserved(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);pbw=self.setup_candidate(root);(root/'releases').mkdir()
            old=root/'releases/SHA256SUMS.txt';old.write_bytes(b'historical checksum\n')
            original=pbw.read_bytes();files=release.freeze(root)
            self.assertEqual(files['Weather-1.2.3.pbw'],original);self.assertEqual(old.read_bytes(),b'historical checksum\n')
            with zipfile.ZipFile(root/'releases/Weather-1.2.3-source.zip') as source:
                self.assertEqual(source.read('README.md'),b'Current source')
                self.assertFalse(any(n.startswith(('dist/','build/','releases/')) or n.endswith('.pbw') for n in source.namelist()))
            self.assertEqual(files['Weather-1.2.3-store-package.zip'],(root/'build/store/Weather-1.2.3-store-package.zip').read_bytes())
            before={p.name:p.read_bytes() for p in (root/'releases').iterdir()}
            pbw.unlink()
            with self.assertRaisesRegex(ValueError,'Frozen version'):release.freeze(root)
            self.assertEqual(before,{p.name:p.read_bytes() for p in (root/'releases').iterdir()})
    def test_changed_candidate_or_store_kit_is_rejected_before_writing(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);self.setup_candidate(root)
            with zipfile.ZipFile(root/'build/store/Weather-1.2.3-store-package.zip','a') as archive:archive.writestr('extra.txt','unreviewed')
            with self.assertRaisesRegex(ValueError,'stale'):release.freeze(root)
            self.assertFalse((root/'releases').exists())
    def test_explicit_candidate_and_store_kit_paths_preserve_exact_reviewed_bytes(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);pbw=self.setup_candidate(root)
            review=root/'build/review';review.mkdir()
            pbw=pbw.rename(review/pbw.name)
            original=pbw.read_bytes()
            checked_kit=(root/'build/store/Weather-1.2.3-store-package.zip').rename(review/'checked-kit.zip')
            files=release.freeze(root,pbw=pbw,store_kit=checked_kit)
            self.assertEqual(files['Weather-1.2.3.pbw'],original)
            self.assertEqual(files['Weather-1.2.3-store-package.zip'],checked_kit.read_bytes())
    def test_missing_candidate_never_falls_back_to_frozen_dist(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);pbw=self.setup_candidate(root);original=pbw.read_bytes()
            (root/'dist').mkdir();frozen=root/'dist'/pbw.name;pbw.rename(frozen)
            with self.assertRaises(FileNotFoundError):release.freeze(root)
            self.assertEqual(frozen.read_bytes(),original)
            self.assertFalse((root/'releases').exists())
    def test_default_build_store_and_freeze_use_the_same_candidate(self):
        from test_package import BUILD
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);subprocess.run(['git','init','-q',str(root)],check=True);fixture(root)
            listing=json.loads((root/'store/listing.json').read_text());listing['artifact_stem']='CHMU-Weather';(root/'store/listing.json').write_text(json.dumps(listing))
            metadata=json.loads((root/'package.json').read_text())
            metadata['pebble'].update(projectType='plugin',configPage='config.html')
            metadata['pebble']['plugin'].update(script='plugin.js',sources=[{'category':'weather','items':['location'],'properties':{'temperature':['numericValue']}}])
            (root/'package.json').write_text(json.dumps(metadata))
            (root/'build').mkdir();(root/'build/plugin.js').write_bytes(b'// CHMU_BUILD_VARIANT=public\n(()=>{})();')
            (root/'src').mkdir();(root/'src/config.html').write_text('<html data-build-variant="__CHMU_BUILD_VARIANT__">Settings</html>')
            (root/'dist').mkdir();frozen=root/'dist/CHMU-Weather-1.2.3.pbw';frozen.write_bytes(b'previous frozen package')
            candidate=BUILD.build_project(root,run_js=False)
            with patch.object(kit,'ROOT',root),patch('sys.argv',['store-kit.py']):kit.main()
            (root/'scripts').mkdir();shutil.copyfile(ROOT/'scripts/store-kit.py',root/'scripts/store-kit.py')
            files=release.freeze(root)
            self.assertEqual(files[candidate.name],candidate.read_bytes())
            with zipfile.ZipFile(root/'releases/CHMU-Weather-1.2.3-store-package.zip') as archive:
                self.assertEqual(archive.read(candidate.name),candidate.read_bytes())
            self.assertEqual(frozen.read_bytes(),b'previous frozen package')
if __name__=='__main__':unittest.main()
