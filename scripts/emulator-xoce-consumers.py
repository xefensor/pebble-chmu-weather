#!/usr/bin/env python3
"""Render exact provider/PKJS fixture packets in unmodified native face PBWs.

Requires the Pebble SDK Python environment. Phone SDK and HTTP remain fixtures.
"""
from pathlib import Path
import argparse,hashlib,json,os,sys,time,uuid,zipfile
from pebble_tool.commands.install import ToolAppInstaller
from libpebble2.protocol.apps import AppRunState,AppRunStateStart,AppRunStateStop
from libpebble2.protocol.system import TimeMessage,SetUTC
from libpebble2.services.appmessage import AppMessageService,ByteArray
from libpebble2.services.screenshot import Screenshot
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--face',choices=['Dynamic','Halftone'],required=True)
args=parser.parse_args()
pipeline=ROOT/'build/qa/xoce-consumers/pipeline.json'
data=json.loads(pipeline.read_text())
entry=next(x for x in data['consumers'] if x['name']==args.face)
pbw=Path(entry['file'])
assert hashlib.sha256(pbw.read_bytes()).hexdigest()==entry['sha256']
out=pipeline.parent/args.face.lower();out.mkdir(exist_ok=True)
os.environ['PEBBLE_QA_STATE']=str(out/'emulator')
sys.path.insert(0,str(ROOT.parent/'recovery-validation'))
from pipe_emulator import connect
with zipfile.ZipFile(pbw) as source,zipfile.ZipFile(out/'native.pbw','w') as native:
 info=json.loads(source.read('appinfo.json'))
 for name in source.namelist():
  if name=='appinfo.json' or name.startswith('emery/'):native.writestr(name,source.read(name))
p=connect();service=AppMessageService(p);target=uuid.UUID(info['uuid'])
ToolAppInstaller(p,str(out/'native.pbw'),quiet=True).install()
captures=[]
def clock(now):p.send_packet(TimeMessage(message=SetUTC(unix_time=now,utc_offset=0,tz_name='UTC')))
def capture(name):
 path=out/(name+'.png')
 Image.frombytes('RGB',(200,228),b''.join(Screenshot(p).grab_image())).save(path)
 captures.append({'file':path.name,'sha256':hashlib.sha256(path.read_bytes()).hexdigest()})
def send(packet):
 service.send_message(target,{info['messageKeys']['COMPLICATION_DATA']:ByteArray(bytes(packet))});time.sleep(.4)
for case in entry['cases']:
 p.send_packet(AppRunState(data=AppRunStateStop(uuid=target)));time.sleep(.12)
 clock(case['now']);p.send_packet(AppRunState(data=AppRunStateStart(uuid=target)));time.sleep(.5)
 send(case['packet']);capture(case['name'])
 if case.get('deniedPacket'):
  send(case['deniedPacket']);capture('live-permission-revoked')
  send(case['packet'])
  # Cross a natural minute tick without delivering a new source packet.
  clock((case['expiryTime']//60+1)*60-1);time.sleep(1.4)
  capture('original-lease-expired')
report={'result':'CAPTURED','pbwSha256':entry['sha256'],'pipelineSha256':hashlib.sha256(pipeline.read_bytes()).hexdigest(),'firmware':str(p.watch_info.running),'captures':captures,'scope':'Unmodified final native C/resources in Emery QEMU, exact packets from the packaged public provider/face pipeline. Native receipt transport is real; phone discovery, permission events and public HTTP are fixtures. Images require visual review. No physical device claim.'}
(out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps({'result':'CAPTURED','report':str(out/'report.json')}))
