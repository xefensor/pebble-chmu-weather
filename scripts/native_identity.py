"""Renderer identity across SDK 4.44 timestamp and GNU build-ID changes only."""
import hashlib,struct
GNU_NOTE=struct.pack('<III',4,20,3)+b'GNU\0'
def renderer_identity(binary,resources):
    binary=bytearray(binary);resources=bytearray(resources)
    if len(binary)<168 or binary[:8]!=b'PBLAPP\0\0' or binary[8:10]!=b'\x10\x01' or binary[132:148]!=GNU_NOTE:
        raise ValueError('Expected SDK 4.44 header and GNU SHA1 build-ID note')
    if len(resources)<4108:raise ValueError('Truncated renderer resource pack')
    # Keep every executable byte, constant, UUID, version, length and platform bit.
    binary[20:24]=b'\0'*4;binary[124:128]=b'\0'*4;binary[148:168]=b'\0'*20
    resources[8:12]=b'\0'*4
    return {'nativeRendererSha256':hashlib.sha256(binary).hexdigest(),
            'resourceRendererSha256':hashlib.sha256(resources).hexdigest()}
