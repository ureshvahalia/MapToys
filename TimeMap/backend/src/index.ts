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

export interface ServerOptions {
  port?:      number;
  dataDir?:   string;
  staticDir?: string;  // path to built frontend — enables production static serving
}

export async function startServer(options: ServerOptions = {}): Promise<void> {
  const PORT        = options.port    ?? Number(process.env.PORT ?? 3001);
  const DATA_DIR    = options.dataDir ?? process.env.TIMEMAP_DATA_DIR ?? path.join(os.homedir(), '.timemap');
  const DB_PATH     = path.join(DATA_DIR, 'timemap.db');
  const THUMBS_DIR  = path.join(DATA_DIR, 'thumbs');

  fs.mkdirSync(DATA_DIR,   { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const db = await openDb(DB_PATH);
  initDb(db);
  persist();

  const app = express();

  // CORS only needed in dev when the Vite frontend runs on a different port
  if (!options.staticDir) {
    app.use(cors({ origin: 'http://localhost:5173' }));
  }

  app.use(express.json());
  app.use((req, _res, next) => { console.log(`${req.method} ${req.url}`); next(); });

  app.use('/api/artifacts',   artifactsRouter());
  app.use('/api/photos',      photosRouter());
  app.use('/api/collections', collectionsRouter());
  app.use('/api/import',      importRouter(DB_PATH, THUMBS_DIR));
  app.use('/api/fs',          fsRouter());

  // Serve the built frontend in production (must come after API routes)
  const staticDir = options.staticDir;
  if (staticDir) {
    app.use(express.static(staticDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(staticDir, 'index.html'));
    });
  }

  return new Promise((resolve, reject) => {
    app.listen(PORT, () => {
      console.log(`TimeMap backend listening on http://localhost:${PORT}`);
      console.log(`Data directory : ${DATA_DIR}`);
      console.log(`Database       : ${DB_PATH}`);
      console.log(`Thumbnails     : ${THUMBS_DIR}`);
      resolve();
    }).on('error', reject);
  });
}

// Run directly in development / CLI usage
if (require.main === module) {
  startServer().catch((err: unknown) => { console.error(err); process.exit(1); });
}
