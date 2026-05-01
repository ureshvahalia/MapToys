import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { openDb, getDb, persist } from '../db/connection';
import { initDb } from '../db/schema';
import {
  runFolderImport,
  runDigikamImport,
  listDigikamAlbums,
  type ImportOptions,
  type ImportStats,
} from '../lib/importer';

interface ImportJob {
  id:               string;
  status:           'running' | 'done' | 'cancelled' | 'error';
  phase:            string;
  progress:         { done: number; total: number };
  log:              string[];
  stats?:           ImportStats;
  error?:           string;
  startedAt:        number;
  finishedAt?:      number;
  cancelRequested:  boolean;
}

const jobs = new Map<string, ImportJob>();
const MAX_LOG_LINES = 500;

function makeJobId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function importRouter(dbPath: string, thumbsDir: string, previewDir: string) {
  const router = Router();

  // POST /api/import/start
  router.post('/start', (req, res) => {
    const {
      type, source, digikamPath, digikamRoot,
      collection, dryRun = false,
      includeNoGps = false, inferGps = false,
      inferGpsWindowMin = 30,
      albumFilter, tagFilter,
    } = req.body as Record<string, unknown>;

    if (!collection) {
      res.status(400).json({ error: 'collection is required' }); return;
    }
    if (type === 'folder' && !source) {
      res.status(400).json({ error: 'source is required for folder import' }); return;
    }
    if (type === 'digikam' && (!digikamPath || !digikamRoot)) {
      res.status(400).json({ error: 'digikamPath and digikamRoot are required for DigiKam import' }); return;
    }
    if (type !== 'folder' && type !== 'digikam') {
      res.status(400).json({ error: 'type must be "folder" or "digikam"' }); return;
    }

    const jobId = makeJobId();
    const job: ImportJob = {
      id: jobId,
      status: 'running',
      phase: 'Starting',
      progress: { done: 0, total: 0 },
      log: [],
      startedAt: Date.now(),
      cancelRequested: false,
    };
    jobs.set(jobId, job);

    const opts: ImportOptions = {
      dryRun:           !!dryRun,
      includeNoGps:     !!includeNoGps,
      inferGps:         !!inferGps,
      inferGpsWindowMs: Number(inferGpsWindowMin ?? 30) * 60 * 1000,
      thumbsDir,
    };

    const onLog = (msg: string) => {
      job.log.push(msg);
      if (job.log.length > MAX_LOG_LINES) job.log.splice(0, job.log.length - MAX_LOG_LINES);
    };

    const onProgress = (done: number, total: number, phase: string) => {
      job.progress = { done, total };
      job.phase    = phase;
    };

    (async () => {
      try {
        let stats: ImportStats;
        const cancelled = () => job.cancelRequested;
        if (type === 'folder') {
          stats = await runFolderImport(
            source as string, collection as string, opts, onLog, onProgress, cancelled,
          );
        } else {
          stats = await runDigikamImport(
            digikamPath as string, digikamRoot as string, collection as string,
            opts,
            albumFilter as string | undefined,
            tagFilter   as string | undefined,
            onLog, onProgress, cancelled,
          );
        }
        job.status     = job.cancelRequested ? 'cancelled' : 'done';
        job.stats      = stats;
        job.finishedAt = Date.now();
        onProgress(stats.total, stats.total, job.status === 'cancelled' ? 'Cancelled' : 'Done');
        if (!job.cancelRequested) {
          onLog(
            `Import complete — imported: ${stats.imported}, skipped: ${stats.skipped}` +
            (stats.noGps   ? `, no-GPS: ${stats.noGps}`     : '') +
            (stats.missing ? `, missing: ${stats.missing}`   : '') +
            (stats.errors  ? `, errors: ${stats.errors}`     : ''),
          );
        }
      } catch (err) {
        job.status     = 'error';
        job.error      = String(err);
        job.finishedAt = Date.now();
        onLog(`Fatal error: ${err}`);
      }
    })();

    res.json({ jobId });
  });

  // GET /api/import/jobs/:id
  router.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) { res.status(404).json({ error: 'job not found' }); return; }
    res.json(job);
  });

  // POST /api/import/jobs/:id/cancel
  router.post('/jobs/:id/cancel', (req, res) => {
    const job = jobs.get(req.params.id);
    if (!job) { res.status(404).json({ error: 'job not found' }); return; }
    if (job.status !== 'running') { res.status(400).json({ error: 'job is not running' }); return; }
    job.cancelRequested = true;
    res.json({ ok: true });
  });

  // GET /api/import/albums?digikam=<path>
  router.get('/albums', async (req, res) => {
    const dkPath = req.query.digikam as string;
    if (!dkPath) { res.status(400).json({ error: 'digikam query param required' }); return; }
    if (!fs.existsSync(dkPath)) { res.status(404).json({ error: `File not found: ${dkPath}` }); return; }
    try {
      const albums = await listDigikamAlbums(dkPath);
      res.json(albums);
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/import/reload  — reload the in-memory DB from disk after an import run
  router.post('/reload', async (_req, res) => {
    try {
      const db = await openDb(dbPath);
      initDb(db);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /api/import/reset  — wipe all data and thumbnails, start fresh
  router.post('/reset', (_req, res) => {
    try {
      const db = getDb();
      // Delete in FK-safe order
      db.run('DELETE FROM photos');
      db.run('DELETE FROM artifacts');
      db.run('DELETE FROM collections');
      persist();

      // Remove all cached thumbnails and previews
      for (const dir of [thumbsDir, previewDir]) {
        if (fs.existsSync(dir)) {
          for (const f of fs.readdirSync(dir)) {
            if (f.endsWith('.jpg')) fs.unlinkSync(path.join(dir, f));
          }
        }
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
