"""A review kit must exclude private variants and bind images to native bytes."""
from pathlib import Path
import importlib.util,json,struct,tempfile,unittest,zipfile,zlib,hashlib,sys
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'scripts'))
spec=importlib.util.spec_from_file_location('store_kit',ROOT/'scripts/store-kit.py');kit=importlib.util.module_from_spec(spec);spec.loader.exec_module(kit)
PUBLIC='00866104-6ce5-4ae3-952f-9800f437442c'
def png(width,height):
    def chunk(kind,body):return struct.pack('>I',len(body))+kind+body+struct.pack('>I',zlib.crc32(kind+body))
    return b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',width,height,8,2,0,0,0))+chunk(b'IDAT',zlib.compress(b'\0'*(height*(1+width*3))))+chunk(b'IEND',b'')
def fixture(root):
    store=root/'store';store.mkdir();permissions=[{'name':'Internet','reason':'Public weather','required':True,'parameters':{'domains':['data-provider.chmi.cz','opendata.chmi.cz','api.open-meteo.com']}}]
    settings={'displayName':'ČHMÚ Weather','uuid':PUBLIC,'usesPermissions':permissions,'plugin':{'name':'Weather'}}
    (root/'package.json').write_text(json.dumps({'version':'1.2.3','pebble':settings}))
    listing={'name':'ČHMÚ Weather','version':'1.2.3','uuid':PUBLIC,'type':'plugin','price':'free','target_platforms':[],'publication_status':'preparation','store_submission_allowed':False,'description_file':'description.txt','release_notes_file':'release-notes.txt','icons':['icon-small-80.png','icon-large-144.png'],'remaining_publication_gates':['Physical validation','Final approval']}
    (store/'listing.json').write_text(json.dumps(listing))
    for file in ['PRIVACY.md','SUPPORT.md']:(root/file).write_text('Fixture policy')
    for file in ['description.txt','release-notes.txt']:(store/file).write_text('Fixture copy')
    (store/'icon-source.svg').write_text('<svg/>')
    for name,size in [('icon-small-80.png',80),('icon-large-144.png',144)]:(store/name).write_bytes(png(size,size))
    files=['icon-source.svg','icon-small-80.png','icon-large-144.png'];(store/'icon-provenance.json').write_text(json.dumps({'files':{n:kit.sha((store/n).read_bytes()) for n in files}}))
    return {'appinfo.json':json.dumps({**settings,'versionLabel':'1.2.3'}).encode(),'plugin.js':b'// public provider only'}
def package(root,files):
    p=root/'Weather.pbw'
    with zipfile.ZipFile(p,'w') as z:
        for name,value in files.items():z.writestr(name,value)
    return p
class StoreKit(unittest.TestCase):
    def test_public_plugin_kit_has_exact_pbw_and_remains_unpublished(self):
        with tempfile.TemporaryDirectory() as d:
            root=Path(d);pbw=package(root,fixture(root));entries,manifest=kit.payload(root,pbw)
            self.assertEqual(entries[pbw.name],pbw.read_bytes());self.assertFalse(manifest['publicationReady'])
            self.assertFalse(any('screenshot' in name for name in entries));self.assertIn('SHA256SUMS.txt',entries)
    def test_personal_backend_and_native_plugin_are_rejected(self):
        for mutation in ('uuid','domain','bundle','native'):
            with self.subTest(mutation=mutation),tempfile.TemporaryDirectory() as d:
                root=Path(d);files=fixture(root)
                if mutation in ('uuid','domain'):
                    package_info=json.loads((root/'package.json').read_text());info=json.loads(files['appinfo.json'])
                    if mutation=='uuid':
                        info['uuid']=package_info['pebble']['uuid']='a1db6979-5ac3-5c50-841d-aecd9a619d36'
                        listing=json.loads((root/'store/listing.json').read_text());listing['uuid']=info['uuid'];(root/'store/listing.json').write_text(json.dumps(listing))
                    else:info['usesPermissions'][0]['parameters']['domains'].append('chmu.rails.cz');package_info['pebble']['usesPermissions']=info['usesPermissions']
                    (root/'package.json').write_text(json.dumps(package_info));files['appinfo.json']=json.dumps(info).encode()
                if mutation=='bundle':files['plugin.js']=b'fetch("https://chmu.rails.cz")'
                if mutation=='native':files['emery/pebble-app.bin']=b'not phone only'
                with self.assertRaises(ValueError):kit.payload(root,package(root,files))
    def test_png_pixels_and_checksums_must_be_complete(self):
        self.assertEqual(kit.png_size(png(80,80)),(80,80))
        data=bytearray(png(80,80));data[-1]^=1
        for invalid in (bytes(data),png(80,80)[:-1],png(80,80)+b'extra'):
            with self.assertRaises(ValueError):kit.png_size(invalid)
    def test_native_banners_bind_dimensions_source_and_original_screen(self):
        for change in ('valid','size','hash','screen','platform','plugin'):
            with self.subTest(change=change),tempfile.TemporaryDirectory() as d:
                root=Path(d);fixture(root);store=root/'store';listing=json.loads((store/'listing.json').read_text())
                listing.update(type='watchface',banners={'emery':'emery-banner.png'},screenshots={'emery':['emery-screen.png']})
                (store/'emery-screen.png').write_bytes(png(200,228));(store/'emery-banner.png').write_bytes(png(720 if change!='size' else 719,320));(store/'emery-banner.svg').write_text('<svg/>')
                artwork={'originalArtwork':True,'files':{n:kit.sha((store/n).read_bytes()) for n in ['emery-banner.png','emery-banner.svg']},'banners':{'emery':{'file':'emery-banner.png','platform':'emery','screenshot':'emery-screen.png','screenshotSha256':kit.sha((store/'emery-screen.png').read_bytes())}}}
                if change=='hash':artwork['files']['emery-banner.png']='0'*64
                if change=='screen':artwork['banners']['emery']['screenshotSha256']='0'*64
                if change=='platform':listing['banners']['gabbro']=listing['banners'].pop('emery')
                if change=='plugin':listing['type']='plugin'
                (store/'artwork-provenance.json').write_text(json.dumps(artwork));(store/'ARTWORK-LICENSES.txt').write_text('Original artwork; font attribution')
                if change=='valid':self.assertIn('emery-banner.png',kit.banner_payload(store,listing,['emery']))
                else:
                    with self.assertRaises(ValueError):kit.banner_payload(store,listing,['emery'])
    def test_renderer_hash_excludes_only_identified_sdk_metadata(self):
        def identity(change=None):
            binary=bytearray(200);binary[:8]=b'PBLAPP\0\0';binary[8:10]=b'\x10\x01';binary[132:148]=kit.GNU_NOTE
            resources=bytearray(4108)
            if change=='metadata':binary[20:24]=b'crc!';binary[124:128]=b'time';binary[148:168]=b'A'*20;resources[8:12]=b'time'
            if change=='code':binary[180]=1
            if change=='resources':resources.append(1)
            with tempfile.TemporaryDirectory() as d:
                path=Path(d)/'native.pbw'
                with zipfile.ZipFile(path,'w') as z:z.writestr('emery/pebble-app.bin',binary);z.writestr('emery/app_resources.pbpack',resources)
                with zipfile.ZipFile(path) as z:return kit.render_identity(z,'emery')
        self.assertEqual(identity(),identity('metadata'))
        self.assertNotEqual(identity(),identity('code'));self.assertNotEqual(identity(),identity('resources'))
if __name__=='__main__':unittest.main()
