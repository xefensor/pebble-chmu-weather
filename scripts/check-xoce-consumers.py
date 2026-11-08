#!/usr/bin/env python3
"""Check packaged provider-to-face delivery with each consumer's pinned C decoder."""
from pathlib import Path
import argparse,hashlib,io,json,os,subprocess,tarfile,tempfile,zipfile
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--provider',type=Path,default=ROOT/'build/candidate/CHMU-Weather.pbw')
p.add_argument('--consumer',type=Path,action='append',required=True)
p.add_argument('--core',type=Path,required=True,help='Consumer pinned pebble-watchface-core tgz')
p.add_argument('--output',type=Path,default=ROOT/'build/qa/xoce-consumers')
a=p.parse_args();out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
for consumer in a.consumer:
 pinned=consumer.resolve().parents[2]/'vendor'/a.core.name
 assert pinned.read_bytes()==a.core.read_bytes(),f'Decoder pin differs for {consumer}'
with tempfile.TemporaryDirectory(prefix='chmu-xoce-') as temporary:
 tmp=Path(temporary)
 with tarfile.open(a.core) as archive:
  body=archive.extractfile('package/dist.zip').read()
 with zipfile.ZipFile(io.BytesIO(body)) as archive:
  for name in archive.namelist():
   if name.startswith('include/') and '..' not in Path(name).parts:archive.extract(name,tmp)
 decoder=tmp/'decode'
 subprocess.run([os.environ.get('CC','cc'),'-std=c99','-Wall','-Wextra','-Werror','-I'+str(tmp/'include'),str(ROOT/'scripts/xoce-wire-probe.c'),'-o',str(decoder)],check=True)
 options={'provider':str(a.provider.resolve()),'consumers':[str(x.resolve()) for x in a.consumer],'decoder':str(decoder),'output':str(out),'coreSha256':hashlib.sha256(a.core.read_bytes()).hexdigest()}
 config=tmp/'options.json';config.write_text(json.dumps(options))
 subprocess.run(['node',str(ROOT/'scripts/check-xoce-consumers.cjs'),str(config)],cwd=ROOT,check=True)
