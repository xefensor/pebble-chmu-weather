#!/usr/bin/env python3
"""Freeze the exact checked public candidate; never rebuild or replace a version."""
from pathlib import Path
import hashlib,importlib.util,io,json,subprocess,zipfile

def digest(data):return hashlib.sha256(data).hexdigest()
def zipped(files):
    output=io.BytesIO()
    with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as archive:
        for name,data in sorted(files.items()):
            item=zipfile.ZipInfo(name,(1980,1,1,0,0,0));item.compress_type=zipfile.ZIP_DEFLATED
            item.external_attr=0o100644<<16;archive.writestr(item,data)
    return output.getvalue()
def freeze(root):
    package=json.loads((root/'package.json').read_text());listing=json.loads((root/'store/listing.json').read_text())
    stem=listing.get('artifact_stem',listing['name'].replace(' ','-'))+'-'+package['version']
    plugin=listing['type']=='plugin';output=root/'releases';sums=output/('SHA256SUMS-'+package['version']+'.txt')
    suffixes=['.pbw','-source.zip','-store-package.zip']+([] if plugin else ['-debug.zip'])
    targets=[output/(stem+s) for s in suffixes]
    if sums.exists() or any(p.exists() for p in targets):raise ValueError('Frozen version already exists; use a new version.')
    pbw=root/('dist' if plugin else 'build/candidate')/(stem+'.pbw')
    if not plugin:
        from repo_workflow import check_build
        check_build(root,pbw)
    spec=importlib.util.spec_from_file_location('store_kit',root/'scripts/store-kit.py')
    store=importlib.util.module_from_spec(spec);spec.loader.exec_module(store)
    entries,manifest=store.payload(root,pbw)
    kit=root/'build/store'/(stem+'-store-package.zip')
    with zipfile.ZipFile(kit) as archive:
        if set(archive.namelist())!=set(entries) or len(archive.namelist())!=len(entries) or any(archive.read(n)!=data for n,data in entries.items()):
            raise ValueError('Store kit is stale; prepare and check it first.')
    names=subprocess.check_output(['git','ls-files','-co','--exclude-standard','-z'],cwd=root).decode().split('\0')
    sources={}
    excluded={'build','dist','releases','node_modules','.git','.pebble','.venv','.build-tools'}
    for name in sorted(set(names)-{''}):
        path=Path(name);source=root/path
        if path.parts[0] in excluded or '__pycache__' in path.parts or path.suffix.lower() in ('.pbw','.pyc'):continue
        if path.parts[:2]==('docs','qa') and path.suffix.lower() in ('.png','.gif'):continue
        if source.is_symlink():raise ValueError('Source archive refuses symlinks: '+name)
        if source.is_file():sources[name]=source.read_bytes()
    sources['SOURCE-MANIFEST.json']=(json.dumps({'version':package['version'],'files':{n:digest(data) for n,data in sources.items()}},indent=2)+'\n').encode()
    files={stem+'.pbw':pbw.read_bytes(),stem+'-source.zip':zipped(sources),stem+'-store-package.zip':kit.read_bytes()}
    if not plugin:files[stem+'-debug.zip']=pbw.with_name(stem+'-debug.zip').read_bytes()
    if digest(files[stem+'.pbw'])!=manifest['pbwSha256']:raise ValueError('Candidate changed during freeze.')
    output.mkdir(exist_ok=True)
    for name,data in files.items():
        with (output/name).open('xb') as target:target.write(data)
    with sums.open('x') as target:target.write(''.join(digest(data)+'  '+name+'\n' for name,data in sorted(files.items())))
    print(json.dumps({'result':'PASS','version':package['version'],'files':{n:digest(data) for n,data in files.items()},'published':False},indent=2))
    return files
if __name__=='__main__':freeze(Path(__file__).resolve().parents[1])
