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


const HEIC_EXTS = new Set(['.heic', '.heif']);

// One shared Promise per in-flight generation — prevents concurrent Sharp
// processes racing to write the same file.
const generating = new Map<string, Promise<void>>();

async function buildPreview(srcPath: string, destPath: string): Promise<void> {
  // Read into Buffer first — avoids WSL2 filesystem seeking issues on /mnt/e/
  // and lets the heic-convert fallback reuse the data without re-reading.
  const srcBuf = await fs.promises.readFile(srcPath);
  try {
    const buf = await sharp(srcBuf, { failOn: 'error' })
      .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
    await fs.promises.writeFile(destPath, buf);
    return;
  } catch (sharpErr) {
    if (!HEIC_EXTS.has(path.extname(srcPath).toLowerCase())) throw sharpErr;
  }

  // Fallback for HEIC/HEIF: heic-convert uses a WASM HEVC decoder
  const jpegData = await convert({ buffer: srcBuf, format: 'JPEG', quality: 0.92 });
  const resized = await sharp(Buffer.from(jpegData))
    .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  await fs.promises.writeFile(destPath, resized);
}

export function photosRouter(previewDir: string): Router {
  fs.mkdirSync(previewDir, { recursive: true });
  const router = Router();

  router.get('/:id', (req, res, next) => {
    const photo = queryOne<PhotoRow>(
      'SELECT file_path, thumbnail_path FROM photos WHERE artifact_id = ?',
      [Number(req.params.id)],
    );
    if (!photo) { res.status(404).end(); return; }
    res.sendFile(path.resolve(photo.file_path), err => { if (err) next(err); });
  });

  router.get('/:id/thumbnail', (req, res, next) => {
    const photo = queryOne<PhotoRow>(
      'SELECT file_path, thumbnail_path FROM photos WHERE artifact_id = ?',
      [Number(req.params.id)],
    );
    if (!photo?.thumbnail_path) { res.status(404).end(); return; }
    res.sendFile(path.resolve(photo.thumbnail_path), err => { if (err) next(err); });
  });

  router.get('/:id/preview', async (req, res, next) => {
    const photo = queryOne<PhotoRow>(
      'SELECT file_path, thumbnail_path FROM photos WHERE artifact_id = ?',
      [Number(req.params.id)],
    );
    if (!photo) { res.status(404).end(); return; }

    const id          = req.params.id;
    const previewPath = path.join(previewDir, `${id}.jpg`);

    if (fs.existsSync(previewPath)) {
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.sendFile(previewPath, err => { if (err) next(err); });
      return;
    }

    let gen = generating.get(id);
    if (!gen) {
      gen = buildPreview(photo.file_path, previewPath)
        .catch(err => {
          console.error(`[preview] Failed id=${id}:`, err.message);
          throw err;
        })
        .finally(() => generating.delete(id));
      generating.set(id, gen);
    }

    try {
      await gen;
      res.setHeader('Cache-Control', 'public, max-age=86400, immutable');
      res.sendFile(previewPath, err => { if (err) next(err); });
    } catch {
      if (photo.thumbnail_path && fs.existsSync(photo.thumbnail_path)) {
        res.sendFile(path.resolve(photo.thumbnail_path), e => { if (e) next(e); });
      } else {
        res.status(500).end();
      }
    }
  });

  return router;
}
