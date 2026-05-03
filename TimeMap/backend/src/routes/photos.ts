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

const HEIC_EXTS         = new Set(['.heic', '.heif']);
const BROWSER_IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.svg']);

export function photosRouter(): Router {
  const router = Router();

  router.get('/:id', async (req, res, next) => {
    const photo = queryOne<PhotoRow>(
      'SELECT file_path, thumbnail_path FROM photos WHERE artifact_id = ?',
      [Number(req.params.id)],
    );
    if (!photo) { res.status(404).end(); return; }

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
