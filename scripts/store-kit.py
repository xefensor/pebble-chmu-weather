#!/usr/bin/env python3
"""Prepare or check a local Store review kit. Never upload or publish."""
from pathlib import Path
import argparse,hashlib,json,struct,zipfile,zlib

ROOT=Path(__file__).resolve().parents[1]
DISPLAYS={'emery':(200,228),'gabbro':(260,260)}
GNU_NOTE=struct.pack('<III',4,20,3)+b'GNU\0'
def require(condition,message):
    if not condition:raise ValueError(message)
def sha(data):return hashlib.sha256(data).hexdigest()
def render_identity(archive,platform):
    from native_identity import renderer_identity
    return renderer_identity(archive.read(platform+'/pebble-app.bin'),archive.read(platform+'/app_resources.pbpack'))

def png_size(data):
    require(data[:8]==b'\x89PNG\r\n\x1a\n' and data[12:16]==b'IHDR','Expected PNG artwork')
    width,height,bits,color,compression,filters,interlace=struct.unpack_from('>IIBBBBB',data,16)
    require(0<width<=720 and 0<height<=320 and bits==8 and color in (2,6) and not (compression or filters or interlace),'Expected noninterlaced RGB/RGBA PNG')
    at=8;pixels=[];ended=False
    while at<len(data):
        require(at+12<=len(data),'Truncated PNG chunk')
        size=struct.unpack_from('>I',data,at)[0];kind=data[at+4:at+8];end=at+12+size
        require(end<=len(data),'Truncated PNG payload')
        body=data[at+8:at+8+size]
        require(zlib.crc32(kind+body)==struct.unpack_from('>I',data,at+8+size)[0],'PNG chunk checksum differs')
        if kind==b'IDAT':pixels.append(body)
        if kind==b'IEND':
            require(not size and end==len(data),'Invalid PNG end');ended=True
        at=end
    require(ended and pixels,'Incomplete PNG')
    stride=1+width*(3 if color==2 else 4);expected=stride*height
    decoder=zlib.decompressobj();raw=decoder.decompress(b''.join(pixels),expected+1)
    require(len(raw)==expected and decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail,'PNG pixel stream length differs')
    require(all(raw[row*stride]<=4 for row in range(height)),'Invalid PNG row filter')
    return width,height
def banner_payload(store,listing,targets):
    entries={};kind=listing['type'];banners=listing.get('banners',{})
    if banners:
        require(kind!='plugin' and set(banners)==set(targets),'Store banners must match native target platforms')
        artwork=json.loads((store/'artwork-provenance.json').read_text())
        require(artwork.get('originalArtwork') is True,'Banner artwork must declare original provenance')
        for platform,name in banners.items():
            require(Path(name).name==name,'Unsafe banner filename')
            data=(store/name).read_bytes()
            require(png_size(data)==(720,320) and artwork['files'].get(name)==sha(data),'Banner dimensions/provenance differ: '+name)
            source=Path(name).with_suffix('.svg').name
            require(artwork['files'].get(source)==sha((store/source).read_bytes()),'Banner source differs')
            record=artwork['banners'][platform]
            require(record['file']==name and record['platform']==platform and record['screenshot'] in listing['screenshots'][platform] and record['screenshotSha256']==sha((store/record['screenshot']).read_bytes()),'Banner screenshot provenance differs')
            entries[name]=data;entries[source]=(store/source).read_bytes()
        entries['artwork-provenance.json']=(store/'artwork-provenance.json').read_bytes()
        entries['ARTWORK-LICENSES.txt']=(store/'ARTWORK-LICENSES.txt').read_bytes()
    return entries

def payload(root,pbw):
    package=json.loads((root/'package.json').read_text());store=root/'store'
    listing=json.loads((store/'listing.json').read_text());version=package['version'];settings=package['pebble']
    require(listing['version']==version and listing['name']==settings['displayName'] and listing['uuid']==settings['uuid'],'Listing identity differs')
    require(listing['price']=='free' and listing['publication_status']=='preparation' and listing['store_submission_allowed'] is False,'Review kit must retain the publication gate')
    entries={'listing.json':(store/'listing.json').read_bytes(),'PRIVACY.md':(root/'PRIVACY.md').read_bytes(),'SUPPORT.md':(root/'SUPPORT.md').read_bytes()}
    for key in ('description_file','release_notes_file'):
        name=listing[key];require(Path(name).name==name,'Unsafe listing filename');entries[name]=(store/name).read_bytes();require(entries[name].strip(),'Empty listing copy')
    require(pbw.stat().st_size<=4_400_000,'PBW exceeds Store limit');entries[pbw.name]=pbw.read_bytes()
    targets=listing['target_platforms'];kind=listing['type']
    with zipfile.ZipFile(pbw) as z:
        require(z.testzip() is None and len(z.namelist())==len(set(z.namelist())),'Damaged PBW')
        info=json.loads(z.read('appinfo.json'))
        require(info['uuid']==listing['uuid'] and info['versionLabel']==version,'PBW identity differs')
        require(info.get('usesPermissions',[])==settings.get('usesPermissions',[]) and info.get('plugin')==settings.get('plugin'),'PBW permissions/provider differ from package')
        binaries={n.split('/')[0] for n in z.namelist() if n.endswith('/pebble-app.bin')}
        require(all(isinstance(p,dict) and p.get('reason') and isinstance(p.get('required'),bool) for p in info.get('usesPermissions',[])),'Permission reasons/required flags missing')
        if kind=='plugin':
            require(not targets and not binaries and 'plugin' in info,'Phone-only plugin contains a native target or lacks its provider')
            require('screenshots' not in listing,'Plugins have no Store screenshot fields')
            require(info['uuid']=='00866104-6ce5-4ae3-952f-9800f437442c','Only the public Weather UUID is allowed')
            require(b'chmu.rails.cz' not in z.read('plugin.js'),'Personal backend in public plugin')
            allowed={d for p in info['usesPermissions'] if p['name']=='Internet' for d in p['parameters']['domains']}
            require(allowed=={'data-provider.chmi.cz','opendata.chmi.cz','api.open-meteo.com'},'Public Weather domain allowlist differs')
        else:
            require(targets==['emery','gabbro'] and info['targetPlatforms']==targets and binaries==set(targets),'Unexpected native platform; Duo is deferred')
            require(bool(info['watchapp']['watchface'])==(kind=='watchface'),'Wrong Store app type')
            from platform_audit import audit_platforms
            audit_platforms(root,pbw)
            provenance=json.loads((store/'capture-provenance.json').read_text())
            require(provenance['version']==version and provenance['nativePixelsModified'] is False,'Invalid native capture provenance')
            for platform in targets:
                require(provenance['renderer'][platform]==render_identity(z,platform),'Screenshot renderer differs: '+platform)
                screenshots=listing['screenshots'][platform];require(1<=len(screenshots)<=5,'Expected one to five screenshots per target')
                for name in screenshots:
                    require(Path(name).name==name,'Unsafe screenshot filename');data=(store/name).read_bytes();record=provenance['screenshots'][name]
                    require(record['platform']==platform and record['sha256']==sha(data) and png_size(data)==DISPLAYS[platform],'Screenshot dimensions/provenance differ: '+name)
                    entries[name]=data
            entries['capture-provenance.json']=(store/'capture-provenance.json').read_bytes()
    entries.update(banner_payload(store,listing,targets))
    for name in listing.get('additional_description_files',[]):
        require(Path(name).name==name,'Unsafe translated description filename');entries[name]=(store/name).read_bytes()
    icons=listing.get('icons',[])
    if kind in ('plugin','watchapp'):require(icons==['icon-small-80.png','icon-large-144.png'],'Required Store icons missing')
    if icons:
        provenance=json.loads((store/'icon-provenance.json').read_text())
        for name,size in [('icon-small-80.png',80),('icon-large-144.png',144)]:
            data=(store/name).read_bytes();require(png_size(data)==(size,size) and sha(data)==provenance['files'][name],'Icon size/provenance differs');entries[name]=data
        source=(store/'icon-source.svg').read_bytes();require(sha(source)==provenance['files']['icon-source.svg'],'Icon source differs');entries['icon-source.svg']=source
        entries['icon-provenance.json']=(store/'icon-provenance.json').read_bytes()
    if (store/'artwork-provenance.json').is_file():
        artwork=json.loads((store/'artwork-provenance.json').read_text())
        require(artwork.get('originalArtwork') is True,'Artwork provenance must identify original artwork')
        for name,digest in artwork['files'].items():
            require(Path(name).name==name and Path(name).suffix in ('.png','.svg'),'Unsafe artwork filename')
            data=(store/name).read_bytes();require(sha(data)==digest,'Artwork hash differs: '+name);entries[name]=data
        entries['artwork-provenance.json']=(store/'artwork-provenance.json').read_bytes()
        entries['ARTWORK-LICENSES.txt']=(store/'ARTWORK-LICENSES.txt').read_bytes()
    for name in ('LICENSE','THIRD-PARTY-NOTICES.md'):

        if (root/name).is_file():entries[name]=(root/name).read_bytes()
    for name,data in entries.items():require(len(data)<=4_400_000,'Store file exceeds upload limit: '+name)
    entries['README.txt']=('Local review kit for '+listing['name']+' '+version+'.\nNot submitted or published.\n\nRemaining publication gates:\n'+'\n'.join('- '+g for g in listing['remaining_publication_gates'])+'\n\nhttps://developer.repebble.com/guides/appstore-publishing/preparing-a-submission/\nhttps://developer.repebble.com/guides/plugins/publishing-plugins/\n').encode()
    manifest={'schemaVersion':1,'name':listing['name'],'version':version,'uuid':listing['uuid'],'price':'free','kind':kind,'platforms':targets,'publicationReady':False,'pbwSha256':sha(entries[pbw.name]),'files':{name:sha(data) for name,data in sorted(entries.items())}}
    entries['manifest.json']=(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n').encode()
    entries['SHA256SUMS.txt']=''.join(sha(data)+'  '+name+'\n' for name,data in sorted(entries.items())).encode()
    return entries,manifest

def main():
    parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--check',action='store_true');parser.add_argument('--pbw',type=Path);parser.add_argument('--output',type=Path);args=parser.parse_args()
    package=json.loads((ROOT/'package.json').read_text());listing=json.loads((ROOT/'store/listing.json').read_text());stem=listing.get('artifact_stem',listing['name'].replace(' ','-'))
    pbw=args.pbw or ROOT/('dist' if listing['type']=='plugin' else 'build/candidate')/(stem+'-'+package['version']+'.pbw')
    output=args.output or ROOT/'build/store'/(stem+'-'+package['version']+'-store-package.zip')
    entries,manifest=payload(ROOT,pbw)
    if args.check:
        with zipfile.ZipFile(output) as z:
            require(len(z.namelist())==len(set(z.namelist())) and set(z.namelist())==set(entries),'Store kit inventory differs')
            require(all(z.read(n)==data for n,data in entries.items()),'Store kit is stale')
    else:
        require(ROOT/'build' in output.resolve().parents,'Prepared kits belong under ignored build; freeze separately')
        output.parent.mkdir(parents=True,exist_ok=True)
        with zipfile.ZipFile(output,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
            for name,data in sorted(entries.items()):
                info=zipfile.ZipInfo(name,(1980,1,1,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED;info.external_attr=0o100644<<16;z.writestr(info,data)
    print(json.dumps({'result':'PASS','kit':str(output),'sha256':sha(output.read_bytes()),'files':len(entries),'publicationReady':False},indent=2))
if __name__=='__main__':main()
