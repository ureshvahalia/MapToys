import express from 'express';
import cors from 'cors';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { openDb, persist } from './db/connection';
import { initDb } from './db/schema';
import { artifactsRouter } from './routes/artifacts';
import { photosRouter } from './routes/photos';
import { collectionsRouter } from './routes/collections';
import { importRouter } from './routes/import';
import { fsRouter } from './routes/fs';

const PORT        = Number(process.env.PORT ?? 3001);
const DATA_DIR    = process.env.TIMEMAP_DATA_DIR ?? path.join(os.homedir(), '.timemap');
const DB_PATH     = path.join(DATA_DIR, 'timemap.db');
const THUMBS_DIR  = path.join(DATA_DIR, 'thumbs');
const PREVIEW_DIR = path.join(DATA_DIR, 'previews');

async function main() {
  fs.mkdirSync(DATA_DIR,   { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const db = await openDb(DB_PATH);
  initDb(db);
  persist();

  const app = express();
  app.use(cors({ origin: 'http://localhost:5173' }));
  app.use(express.json());
  app.use((req, _res, next) => { console.log(`${req.method} ${req.url}`); next(); });

  app.use('/api/artifacts',   artifactsRouter());
  app.use('/api/photos',      photosRouter(PREVIEW_DIR));
  app.use('/api/collections', collectionsRouter());
  app.use('/api/import',      importRouter(DB_PATH, THUMBS_DIR, PREVIEW_DIR));
  app.use('/api/fs',          fsRouter());

  app.listen(PORT, () => {
    console.log(`TimeMap backend listening on http://localhost:${PORT}`);
    console.log(`Data directory : ${DATA_DIR}`);
    console.log(`Database       : ${DB_PATH}`);
    console.log(`Thumbnails     : ${THUMBS_DIR}`);
  });
}

main().catch(err => { console.error(err); process.exit(1); });
