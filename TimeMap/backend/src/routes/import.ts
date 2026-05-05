import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import { openDb, getDb, persist } from '../db/connection';
import { initDb } from '../db/schema';
import { execFile } from 'node:child_process';
import {
  runFolderImport,
  runDigikamImport,
  runPhotosImport,
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

export function importRouter(dbPath: string, thumbsDir: string, photosHelperPath: string | null) {
  const router = Router();

  // POST /api/import/start
  router.post('/start', (req, res) => {
    const {
      type, source, sources, digikamPath, digikamRoot,
      collection, dryRun = false,
      includeNoGps = false, inferGps = false,
      inferGpsWindowMin = 30,
      albumFilter, tagFilter,
      albumId,
    } = req.body as Record<string, unknown>;

    // Normalize sources: accept sources[] (new) or legacy source string
    const sourcePaths: string[] =
      Array.isArray(sources) && (sources as unknown[]).length > 0 ? sources as string[] :
      typeof source === 'string' && source ? [source] : [];

    if (!collection) {
      res.status(400).json({ error: 'collection is required' }); return;
    }
    if (type === 'folder' && sourcePaths.length === 0) {
      res.status(400).json({ error: 'sources is required for folder import' }); return;
    }
    if (type === 'digikam' && (!digikamPath || !digikamRoot)) {
      res.status(400).json({ error: 'digikamPath and digikamRoot are required for DigiKam import' }); return;
    }
    if (type === 'photos' && !photosHelperPath) {
      res.status(400).json({ error: 'Photos import is not available on this platform' }); return;
    }
    if (type !== 'folder' && type !== 'digikam' && type !== 'photos') {
      res.status(400).json({ error: 'type must be "folder", "digikam", or "photos"' }); return;
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
        if (type === 'photos') {
          stats = await runPhotosImport(
            photosHelperPath!,
            albumId as string | undefined,
            collection as string,
            opts,
            onLog, onProgress, cancelled,
          );
        } else if (type === 'folder') {
          const acc: ImportStats = { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: 0 };
          const multi = sourcePaths.length > 1;
          for (let i = 0; i < sourcePaths.length; i++) {
            if (job.cancelRequested) break;
            const prefix = multi ? `[${i + 1}/${sourcePaths.length}] ` : '';
            const s = await runFolderImport(
              sourcePaths[i], collection as string, opts,
              msg => onLog(prefix + msg),
              (done, total, phase) => onProgress(done, total, prefix + phase),
              cancelled,
            );
            acc.imported += s.imported; acc.skipped += s.skipped; acc.noGps  += s.noGps;
            acc.missing  += s.missing;  acc.errors  += s.errors;  acc.total  += s.total;
          }
          stats = acc;
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

  // GET /api/import/photos-albums
  router.get('/photos-albums', (req, res) => {
    if (!photosHelperPath) {
      res.status(404).json({ error: 'Photos import not available on this platform' }); return;
    }
    execFile(photosHelperPath, ['list-albums'], (err, stdout, stderr) => {
      if (err) {
        const msg = stderr.trim();
        if (msg === 'permission-denied') {
          res.status(403).json({ error: 'Photos access denied. Grant access in System Settings → Privacy & Security → Photos.' });
        } else {
          res.status(500).json({ error: msg || String(err) });
        }
        return;
      }
      try {
        res.json(JSON.parse(stdout));
      } catch {
        res.status(500).json({ error: 'Invalid response from photos helper' });
      }
    });
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

      // Remove cached thumbnails
      if (fs.existsSync(thumbsDir)) {
        for (const f of fs.readdirSync(thumbsDir)) {
          if (f.endsWith('.jpg')) fs.unlinkSync(path.join(thumbsDir, f));
        }
      }

      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
}
