"""Real 2GB expansion with EICAR as the last member; never execute contents."""
import hashlib
import json
import pathlib
import random
import sys
import zipfile

root = pathlib.Path(sys.argv[1])
manifest_path = root / 'expansion-manifest.json'
manifest = json.loads(manifest_path.read_text())
path = root / 'expanded-tail-eicar.zip'
eicar = b'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'
rng = random.Random(20261125)
remaining = 2000000000 - len(eicar)
with zipfile.ZipFile(path, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
    for index in range(4):
        size = min(500000000, remaining)
        with archive.open(f'assets/part-{index}.bin', 'w') as member:
            left = size
            while left:
                block = rng.randbytes(4096) * 8
                chunk = block[:min(left, len(block))]
                member.write(chunk)
                left -= len(chunk)
        remaining -= size
    archive.writestr('last/eicar.txt', eicar)
assert remaining == 0
h = hashlib.sha256()
with path.open('rb') as source:
    for chunk in iter(lambda: source.read(1048576), b''):
        h.update(chunk)
row = {'name': path.name, 'bytes': path.stat().st_size, 'expandedBytes': 2000000000,
       'sha256': h.hexdigest(), 'expected': 'rejected', 'reason': 'MALWARE_DETECTED'}
manifest = [x for x in manifest if x['name'] != path.name] + [row]
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(row))
