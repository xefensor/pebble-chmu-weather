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
        pbw=package(root,files);(root/'dist').mkdir();pbw=pbw.rename(root/'dist/Weather-1.2.3.pbw')
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
if __name__=='__main__':unittest.main()
