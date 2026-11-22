"""Synthetic ZIP expansion boundaries; real bytes, no execution of contents."""
import hashlib,json,pathlib,random,sys,zipfile
root=pathlib.Path(sys.argv[1]);root.mkdir(parents=True,exist_ok=True)
manifest=[]
for total in (1999999999,2000000000,2000000001):
 path=root/f'expanded-{total}.zip';rng=random.Random(20261122);remaining=total
 with zipfile.ZipFile(path,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=1) as archive:
  for n in range(5):
   size=min(500000000,remaining)
   if not size:break
   info=zipfile.ZipInfo(f'assets/part-{n}.bin',(2026,11,22,0,0,0));info.compress_type=zipfile.ZIP_DEFLATED
   with archive.open(info,'w') as member:
    left=size
    while left:
     block=rng.randbytes(4096)*8;chunk=block[:min(left,len(block))];member.write(chunk);left-=len(chunk)
   remaining-=size
 h=hashlib.sha256()
 with path.open('rb') as source:
  for chunk in iter(lambda:source.read(1048576),b''):h.update(chunk)
 row={'name':path.name,'bytes':path.stat().st_size,'expandedBytes':total,'sha256':h.hexdigest(),'expected':'clean' if total<=2000000000 else 'rejected'};manifest.append(row);print(json.dumps(row),flush=True)
(root/'expansion-manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
