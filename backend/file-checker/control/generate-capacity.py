"""Deterministic real-byte fixtures, run with cached checker Python/Pillow.
Synthetic representative formats, not customer/product workload certification.
"""
import binascii
import hashlib
import io
import json
import pathlib
import random
import struct
import sys
import zipfile
from PIL import Image

root = pathlib.Path(sys.argv[1])
root.mkdir(parents=True, exist_ok=True)
rng = random.Random(20261117)
manifest = []


def digest(path):
    h = hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda: f.read(1048576), b''):
            h.update(chunk)
    return h.hexdigest()


def pdf(padding):
    pixels = random.Random(20261117).randbytes(2500*2500*3)
    objects = [b'<< /Type /Catalog /Pages 2 0 R >>',
               b'<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
               b'<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 500] /Contents 4 0 R /Resources << /XObject << /Im0 5 0 R >> >> >>',
               b'<< /Length 31 >>\nstream\nq 500 0 0 500 0 0 cm /Im0 Do Q\n\nendstream',
               b'<< /Type /XObject /Subtype /Image /Width 2500 /Height 2500 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length '+str(len(pixels)).encode()+b' >>\nstream\n'+pixels+b'\nendstream']
    # Long PDF comment supplies exact byte adjustment, outside image/streams.
    data = bytearray(b'%PDF-1.7\n' + (b'%' + b'p'*(padding-2)+b'\n' if padding else b''))
    offsets = [0]
    for i, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data += str(i).encode()+b' 0 obj\n'+obj+b'\nendobj\n'
    xref = len(data)
    data += b'xref\n0 6\n0000000000 65535 f \n'
    for off in offsets[1:]:
        data += f'{off:010} 00000 n \n'.encode()
    data += f'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n'.encode()
    return data


for kind, mime, limit in [('pdf', 'application/pdf', 20000000), ('png', 'image/png', 20000000), ('jpeg', 'image/jpeg', 20000000), ('zip', 'application/zip', 500000000)]:
    if kind in ('png', 'jpeg'):
        wh = (2400, 2400) if kind == 'png' else (4000, 3000)
        image = Image.frombytes('RGB', wh, rng.randbytes(wh[0]*wh[1]*3))
        output = io.BytesIO()
        image.save(output, format=kind.upper(), **({'quality': 95} if kind == 'jpeg' else {}))
        base = output.getvalue()
    for delta in (-1, 0, 1):
        target = limit+delta
        path = root / f'{kind}-{target}.{kind}'
        if kind == 'pdf':
            data = pdf(target-len(pdf(0)))
            # xref decimal width can change by one after padding.
            data = pdf(target-len(data)+target-len(pdf(0)))
            path.write_bytes(data)
        elif kind == 'png':
            payload = b'p'*(target-len(base)-12)
            chunk = b'caPa'+payload  # ancillary, private, safe-to-copy chunk
            path.write_bytes(base[:-12]+struct.pack('>I', len(payload))+chunk+struct.pack('>I', binascii.crc32(chunk)&0xffffffff)+base[-12:])
        elif kind == 'jpeg':
            left = target-len(base)
            comments = bytearray()
            while left:
                size = min(left, 65537)
                if 0 < left-size < 4:
                    size -= 4
                assert size >= 4
                comments += b'\xff\xfe'+struct.pack('>H', size-2)+b'p'*(size-4)
                left -= size
            path.write_bytes(base[:2]+comments+base[2:])
        else:
            small = [('README.md', b'Synthetic source and asset package; data only.\n'), ('src/example.py', b'def example():\n    return 42\n')]
            # ZIP_STORED with fixed timestamps, real non-sparse entropy bytes.
            names = [n for n, _ in small]+['assets/noise.bin']
            overhead = sum(30+46+2*len(n.encode()) for n in names)+22
            payload_size = target-overhead-sum(len(b) for _, b in small)
            entropy = random.Random(20261117).randbytes(1048576)
            with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_STORED) as archive:
                for name, content in small:
                    archive.writestr(zipfile.ZipInfo(name, (2026, 11, 17, 0, 0, 0)), content)
                with archive.open(zipfile.ZipInfo(names[-1], (2026, 11, 17, 0, 0, 0)), 'w') as member:
                    while payload_size:
                        n = min(payload_size, len(entropy))
                        member.write(entropy[:n])
                        payload_size -= n
        assert path.stat().st_size == target, (path, path.stat().st_size, target)
        manifest.append({'name': path.name, 'mime': mime, 'bytes': target, 'sha256': digest(path), 'limit': limit, 'delta': delta, 'kind': kind})
        print(path.name, target, flush=True)
(root/'manifest.json').write_text(json.dumps(manifest, indent=2)+'\n')
