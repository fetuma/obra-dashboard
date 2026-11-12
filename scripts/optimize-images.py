from pathlib import Path
from PIL import Image,ImageOps
import json
out=Path('assets/web/portfolio');out.mkdir(parents=True,exist_ok=True)
rows=[]
for p in sorted(Path('portifolio').glob('p[0-9][0-9].webp')):
 im=ImageOps.exif_transpose(Image.open(p)).convert('RGB')
 row={'file':p.name,'original':p.stat().st_size}
 for size,quality in [(640,76),(1920,80)]:
  copy=im.copy();copy.thumbnail((size,size),Image.Resampling.LANCZOS)
  dest=out/(p.stem+'-'+str(size)+'.webp');copy.save(dest,'WEBP',quality=quality,method=6)
  row[str(size)]=dest.stat().st_size
 rows.append(row)
Path('scripts/image-report.json').write_text(json.dumps(rows,indent=2))
print({k:sum(r[k] for r in rows) for k in ['original','640','1920']})
