import { Router } from 'express';
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import convert from 'heic-convert';
import { queryOne } from '../db/connection';

interface PhotoRow {
  file_path:      string;
  thumbnail_path: string | null;
}

interface ArtifactRow {
  title:     string | null;
  timestamp: string;
}

interface AdjacentRow { id: number; }

const HEIC_EXTS         = new Set(['.heic', '.heif']);
const BROWSER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);

function viewerHtml(id: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>TimeMap — Photo</title>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html,body{height:100%;background:#0a0d18;color:#e0e0e0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;overflow:hidden}
#app{display:flex;flex-direction:column;height:100vh}
#photo-wrap{flex:1;display:flex;align-items:center;justify-content:center;overflow:hidden;padding:12px}
#photo{max-width:100%;max-height:100%;object-fit:contain;display:block}
#nav{display:flex;align-items:center;gap:12px;padding:10px 16px;background:rgba(0,0,0,.45);border-top:1px solid rgba(255,255,255,.08);flex-shrink:0}
.btn{background:rgba(255,255,255,.1);color:#e0e0e0;border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:6px 20px;font-size:14px;cursor:pointer;min-width:90px;transition:background .15s}
.btn:hover:not(:disabled){background:rgba(255,255,255,.18)}
.btn:disabled{opacity:.3;cursor:default}
#info{flex:1;text-align:center;font-size:13px;line-height:1.4;overflow:hidden}
#info-title{color:rgba(255,255,255,.85);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#info-date{color:rgba(255,255,255,.45);font-size:12px}
</style>
</head>
<body>
<div id="app">
  <div id="photo-wrap"><img id="photo" src="/api/photos/${id}" alt="Photo"></div>
  <div id="nav">
    <button class="btn" id="btn-prev" disabled>&#8592; Prev</button>
    <div id="info"><div id="info-title">&#8230;</div><div id="info-date"></div></div>
    <button class="btn" id="btn-next" disabled>Next &#8594;</button>
  </div>
</div>
<script>
(function(){
  var id=${id};
  var btnPrev=document.getElementById('btn-prev');
  var btnNext=document.getElementById('btn-next');
  var infoTitle=document.getElementById('info-title');
  var infoDate=document.getElementById('info-date');
  fetch('/api/photos/'+id+'/adjacent').then(function(r){return r.json();}).then(function(d){
    infoTitle.textContent=d.title||('Photo '+id);
    if(d.timestamp){
      var dt=new Date(d.timestamp);
      infoDate.textContent=dt.toLocaleDateString(undefined,{year:'numeric',month:'long',day:'numeric'})+
        ' · '+dt.toLocaleTimeString(undefined,{hour:'2-digit',minute:'2-digit'});
    }
    if(d.prevId!=null){btnPrev.disabled=false;btnPrev.onclick=function(){new BroadcastChannel('timemap').postMessage({type:'photo-navigate',id:d.prevId});location.href='/api/photos/'+d.prevId+'/viewer';};}
    if(d.nextId!=null){btnNext.disabled=false;btnNext.onclick=function(){new BroadcastChannel('timemap').postMessage({type:'photo-navigate',id:d.nextId});location.href='/api/photos/'+d.nextId+'/viewer';};}
  }).catch(function(){infoTitle.textContent='Photo '+id;});
  document.addEventListener('keydown',function(e){
    if(e.key==='ArrowLeft'&&!btnPrev.disabled)btnPrev.click();
    if(e.key==='ArrowRight'&&!btnNext.disabled)btnNext.click();
    if(e.key==='Escape')window.close();
  });
})();
</script>
</body>
</html>`;
}

export function photosRouter(): Router {
  const router = Router();

  router.get('/:id/viewer', (req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(viewerHtml(Number(req.params.id)));
  });

  router.get('/:id/adjacent', (req, res) => {
    const id = Number(req.params.id);
    const artifact = queryOne<ArtifactRow>(
      'SELECT title, timestamp FROM artifacts WHERE id = ?',
      [id],
    );
    if (!artifact) { res.status(404).json({ error: 'Not found' }); return; }

    const prev = queryOne<AdjacentRow>(
      `SELECT a.id FROM artifacts a JOIN photos p ON p.artifact_id = a.id
       WHERE a.timestamp < ? ORDER BY a.timestamp DESC LIMIT 1`,
      [artifact.timestamp],
    );
    const next = queryOne<AdjacentRow>(
      `SELECT a.id FROM artifacts a JOIN photos p ON p.artifact_id = a.id
       WHERE a.timestamp > ? ORDER BY a.timestamp ASC LIMIT 1`,
      [artifact.timestamp],
    );

    res.json({
      prevId:    prev?.id ?? null,
      nextId:    next?.id ?? null,
      title:     artifact.title,
      timestamp: artifact.timestamp,
    });
  });

  router.get('/:id', async (req, res, next) => {
    const photo = queryOne<PhotoRow>(
      'SELECT file_path, thumbnail_path FROM photos WHERE artifact_id = ?',
      [Number(req.params.id)],
    );
    if (!photo) { res.status(404).end(); return; }

    // iCloud-only photos have a photos:// URI rather than a real path
    if (photo.file_path.startsWith('photos://')) {
      res.status(503).json({ error: 'This photo is stored in iCloud and is not available locally.' });
      return;
    }

    const ext = path.extname(photo.file_path).toLowerCase();

    // Browser-native formats: serve as-is
    if (BROWSER_IMAGE_EXTS.has(ext)) {
      res.setHeader('Content-Disposition', 'inline');
      res.sendFile(path.resolve(photo.file_path), err => { if (err) next(err); });
      return;
    }

    // Non-native formats: convert to JPEG on the fly
    try {
      const srcBuf = await fs.promises.readFile(photo.file_path);
      let jpegBuf: Buffer;
      try {
        jpegBuf = await sharp(srcBuf).jpeg({ quality: 95 }).toBuffer();
      } catch (sharpErr) {
        if (!HEIC_EXTS.has(ext)) throw sharpErr;
        // HEIC/HEIF: fall back to WASM HEVC decoder
        const jpegData = await convert({ buffer: srcBuf, format: 'JPEG', quality: 0.95 });
        jpegBuf = Buffer.from(jpegData);
      }
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('Content-Disposition', 'inline');
      res.end(jpegBuf);
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id/thumbnail', (req, res, next) => {
    const photo = queryOne<PhotoRow>(
      'SELECT file_path, thumbnail_path FROM photos WHERE artifact_id = ?',
      [Number(req.params.id)],
    );
    if (!photo?.thumbnail_path) { res.status(404).end(); return; }
    res.sendFile(path.resolve(photo.thumbnail_path), err => { if (err) next(err); });
  });

  return router;
}
