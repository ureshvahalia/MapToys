import path from 'node:path';
import fs from 'node:fs';
import { spawn } from 'node:child_process';
import { getDb, queryOne, execute, persist } from '../db/connection';
import initSqlJs from 'sql.js';
import type { Database as SqlJsDb } from 'sql.js';
import * as exifr from 'exifr';
import sharp from 'sharp';
import convert from 'heic-convert';

export const IMAGE_EXTS = new Set([
  '.jpg', '.jpeg', '.png', '.tiff', '.tif',
  '.heic', '.heif', '.webp',
  '.cr2', '.cr3', '.nef', '.arw', '.dng', '.raf', '.rw2', '.orf',
]);

const THUMB_SIZE        = 400;
const PERSIST_EVERY     = 50;
const IMPORT_CONCURRENCY = 4;   // matches Node.js default libuv thread pool size

export interface ImportOptions {
  dryRun: boolean;
  includeNoGps: boolean;
  inferGps: boolean;
  inferGpsWindowMs: number;
  thumbsDir: string;
}

export interface ImportStats {
  imported: number;
  skipped: number;
  noGps: number;
  missing: number;
  errors: number;
  total: number;
}

export interface ExifResult {
  latitude?: number;
  longitude?: number;
  timestamp?: Date;
  make?: string;
  model?: string;
  width?: number;
  height?: number;
}

interface GeoPoint { ts: Date; lat: number; lng: number; }

export interface DigiKamAlbum {
  path: string;
  photoCount: number;
}

// ---- EXIF -------------------------------------------------------------------

export async function readExif(filePath: string): Promise<ExifResult> {
  try {
    const d = await exifr.parse(filePath, { gps: true, tiff: true, xmp: false, icc: false });
    if (!d) return {};
    return {
      latitude:  typeof d.latitude  === 'number' ? d.latitude  : undefined,
      longitude: typeof d.longitude === 'number' ? d.longitude : undefined,
      timestamp: d.DateTimeOriginal instanceof Date ? d.DateTimeOriginal : undefined,
      make:      typeof d.Make  === 'string' ? d.Make  : undefined,
      model:     typeof d.Model === 'string' ? d.Model : undefined,
      width:     d.ImageWidth  ?? d.ExifImageWidth  ?? undefined,
      height:    d.ImageHeight ?? d.ExifImageHeight ?? undefined,
    };
  } catch { return {}; }
}

// ---- GPS inference ----------------------------------------------------------

export function findNearestGps(
  ts: Date,
  sorted: GeoPoint[],
  windowMs: number,
): { lat: number; lng: number } | null {
  if (!sorted.length) return null;
  const target = ts.getTime();
  let lo = 0, hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].ts.getTime() < target) lo = mid + 1;
    else hi = mid;
  }
  const candidates = [sorted[lo], lo > 0 ? sorted[lo - 1] : null].filter(Boolean) as GeoPoint[];
  let best: GeoPoint | null = null, bestDiff = Infinity;
  for (const c of candidates) {
    const diff = Math.abs(c.ts.getTime() - target);
    if (diff < bestDiff) { bestDiff = diff; best = c; }
  }
  return best && bestDiff <= windowMs ? { lat: best.lat, lng: best.lng } : null;
}

// ---- Thumbnail --------------------------------------------------------------

const HEIC_EXTS = new Set(['.heic', '.heif']);

export async function makeThumbnail(src: string, dest: string): Promise<boolean> {
  try {
    // Read into a Buffer up-front — avoids WSL2 filesystem seeking issues
    // that cause sharp to fail when given a /mnt/e/ path directly, and
    // lets us reuse the data for the heic-convert fallback without re-reading.
    const srcBuf = await fs.promises.readFile(src);
    try {
      const out = await sharp(srcBuf, { failOn: 'error' })
        .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toBuffer();
      await fs.promises.writeFile(dest, out);
      return true;
    } catch (sharpErr) {
      if (!HEIC_EXTS.has(path.extname(src).toLowerCase())) throw sharpErr;
    }
    // Fallback for HEIC/HEIF: heic-convert uses a WASM HEVC decoder
    const jpegData = await convert({ buffer: srcBuf, format: 'JPEG', quality: 0.92 });
    const resized = await sharp(Buffer.from(jpegData))
      .resize(THUMB_SIZE, THUMB_SIZE, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toBuffer();
    await fs.promises.writeFile(dest, resized);
    return true;
  } catch { return false; }
}

// ---- File system ------------------------------------------------------------

export function collectFiles(dir: string): string[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else if (IMAGE_EXTS.has(path.extname(e.name).toLowerCase())) out.push(full);
    }
  };
  walk(dir);
  return out;
}

// ---- DB helpers -------------------------------------------------------------

export function getOrCreateCollection(name: string, dryRun: boolean): number {
  const ex = queryOne<{ id: number }>('SELECT id FROM collections WHERE name = ?', [name]);
  if (ex) return ex.id;
  if (dryRun) return -1;
  execute('INSERT INTO collections (name) VALUES (?)', [name]);
  return queryOne<{ id: number }>('SELECT id FROM collections WHERE name = ?', [name])!.id;
}

export function alreadyImported(filePath: string): boolean {
  return !!queryOne('SELECT 1 FROM photos WHERE file_path = ?', [filePath]);
}

export function dbInsertPhoto(opts: {
  collectionId: number;
  filePath:     string;
  thumbPath:    string | null;
  latitude:     number | null;
  longitude:    number | null;
  timestamp:    string;
  precision:    string;
  title:        string;
  make:         string | null;
  model:        string | null;
  width:        number | null;
  height:       number | null;
  exifJson:     string;
}): number {
  const db = getDb();
  db.run(`
    INSERT INTO artifacts
      (artifact_type, latitude, longitude, timestamp, timestamp_precision, title, collection_id)
    VALUES ('photo', ?, ?, ?, ?, ?, ?)
  `, [opts.latitude, opts.longitude, opts.timestamp, opts.precision, opts.title, opts.collectionId]);

  const id = (db.exec('SELECT last_insert_rowid()')[0].values[0][0]) as number;

  db.run(`
    INSERT INTO photos
      (artifact_id, file_path, thumbnail_path, width, height, camera_make, camera_model, exif_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `, [id, opts.filePath, opts.thumbPath, opts.width, opts.height,
      opts.make, opts.model, opts.exifJson]);

  return id;
}

// ---- Single-file processor --------------------------------------------------

type ProcessStatus = 'imported' | 'skipped' | 'no-gps' | 'error';

async function processFile(
  filePath:     string,
  collectionId: number,
  exif:         ExifResult,
  opts:         ImportOptions,
  inferred?:    { lat: number; lng: number },
): Promise<ProcessStatus> {
  const absPath = path.resolve(filePath);
  if (alreadyImported(absPath)) return 'skipped';

  const lat = exif.latitude  ?? inferred?.lat ?? null;
  const lng = exif.longitude ?? inferred?.lng ?? null;
  const locationSource = exif.latitude ? 'gps' : inferred ? 'inferred' : 'none';

  if (lat === null && !opts.includeNoGps) return 'no-gps';

  const timestamp = exif.timestamp
    ? exif.timestamp.toISOString()
    : new Date(fs.statSync(absPath).mtime).toISOString();
  const precision  = exif.timestamp ? 'second' : 'day';
  const title      = path.basename(absPath, path.extname(absPath));
  const exifPayload = JSON.stringify({ ...exif, locationSource });

  if (opts.dryRun) return 'imported';

  const id = dbInsertPhoto({
    collectionId,
    filePath:  absPath,
    thumbPath: null,
    latitude: lat, longitude: lng,
    timestamp, precision, title,
    make:  exif.make  ?? null,
    model: exif.model ?? null,
    width:  exif.width  ?? null,
    height: exif.height ?? null,
    exifJson: exifPayload,
  });

  const thumbPath = path.join(opts.thumbsDir, `${id}.jpg`);
  const thumbOk   = await makeThumbnail(filePath, thumbPath);
  if (thumbOk) execute('UPDATE photos SET thumbnail_path = ? WHERE artifact_id = ?', [thumbPath, id]);

  return 'imported';
}

// ---- Concurrency pool -------------------------------------------------------

async function runPool<T>(
  items:       T[],
  fn:          (item: T) => Promise<void>,
  concurrency: number,
): Promise<void> {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

// ---- Folder import ----------------------------------------------------------

export async function runFolderImport(
  sourceDir:      string,
  collectionName: string,
  opts:           ImportOptions,
  onLog:          (msg: string) => void,
  onProgress:     (done: number, total: number, phase: string) => void,
  isCancelled?:   () => boolean,
): Promise<ImportStats> {
  onLog(`Scanning ${sourceDir} …`);
  const files = collectFiles(sourceDir);
  onLog(`Found ${files.length} image file(s).`);
  if (!files.length) return { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: 0 };

  onLog('Reading EXIF metadata…');
  const exifMap = new Map<string, ExifResult>();
  let exifDone = 0;
  await runPool(files, async (f) => {
    if (isCancelled?.()) return;
    onProgress(exifDone, files.length, 'Reading EXIF');
    exifMap.set(f, await readExif(f));
    exifDone++;
  }, IMPORT_CONCURRENCY);

  if (isCancelled?.()) {
    onLog('Import cancelled.');
    return { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: files.length };
  }

  let geoRef: GeoPoint[] = [];
  if (opts.inferGps) {
    geoRef = [...exifMap.values()]
      .filter(e => e.latitude && e.longitude && e.timestamp)
      .map(e => ({ ts: e.timestamp!, lat: e.latitude!, lng: e.longitude! }))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    onLog(`GPS inference: ${geoRef.length} geotagged reference photo(s) available.`);
  }

  const collectionId = getOrCreateCollection(collectionName, opts.dryRun);
  const stats: ImportStats = { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: files.length };
  let done = 0, lastPersist = 0;

  await runPool(files, async (filePath) => {
    if (isCancelled?.()) return;
    const name     = path.basename(filePath);
    onProgress(done, files.length, 'Importing');

    const exif     = exifMap.get(filePath)!;
    const inferred = (!exif.latitude && opts.inferGps && exif.timestamp)
      ? findNearestGps(exif.timestamp, geoRef, opts.inferGpsWindowMs) ?? undefined
      : undefined;

    try {
      const status = await processFile(filePath, collectionId, exif, opts, inferred);
      if (status === 'imported') {
        stats.imported++;
        onLog(`imported: ${name}${inferred ? ' (location inferred)' : ''}`);
      } else if (status === 'skipped') {
        stats.skipped++;
      } else if (status === 'no-gps') {
        stats.noGps++;
        onLog(`no-gps: ${name}`);
      }
    } catch (err) {
      stats.errors++;
      onLog(`ERROR: ${name}: ${err}`);
    }

    done++;
    if (!opts.dryRun && done - lastPersist >= PERSIST_EVERY) { persist(); lastPersist = done; }
  }, IMPORT_CONCURRENCY);

  if (!opts.dryRun) persist();
  if (isCancelled?.()) onLog(`Import cancelled after ${stats.imported} imported.`);
  return stats;
}

// ---- DigiKam helpers --------------------------------------------------------

async function openDigikamDbAsync(dkDbPath: string): Promise<SqlJsDb> {
  const SQL = await initSqlJs();
  return new SQL.Database(fs.readFileSync(dkDbPath));
}

function dkCollectRows(
  dkDb:   SqlJsDb,
  sql:    string,
  params: (string | number | null)[],
): Record<string, unknown>[] {
  const stmt = dkDb.prepare(sql);
  stmt.bind(params);
  const rows: Record<string, unknown>[] = [];
  while (stmt.step()) rows.push(stmt.getAsObject());
  stmt.free();
  return rows;
}

// ---- DigiKam: list albums ---------------------------------------------------

export async function listDigikamAlbums(dkDbPath: string): Promise<DigiKamAlbum[]> {
  const dkDb = await openDigikamDbAsync(dkDbPath);
  const rows = dkCollectRows(dkDb, `
    SELECT a.relativePath, COUNT(i.id) AS photo_count
    FROM Albums a
    LEFT JOIN Images i ON i.album = a.id AND i.status = 1 AND i.category = 1
    GROUP BY a.id
    ORDER BY a.relativePath
  `, []);
  dkDb.close();
  return rows.map(r => ({ path: r.relativePath as string, photoCount: r.photo_count as number }));
}

// ---- DigiKam: main import ---------------------------------------------------

export async function runDigikamImport(
  dkDbPath:       string,
  dkRoot:         string,
  collectionName: string,
  opts:           ImportOptions,
  albumFilter:    string | undefined,
  tagFilter:      string | undefined,
  onLog:          (msg: string) => void,
  onProgress:     (done: number, total: number, phase: string) => void,
  isCancelled?:   () => boolean,
): Promise<ImportStats> {
  onLog(`Opening DigiKam DB: ${dkDbPath}`);
  const dkDb = await openDigikamDbAsync(dkDbPath);

  let tagIds: number[] = [];
  if (tagFilter) {
    tagIds = dkCollectRows(dkDb, `
      WITH RECURSIVE tag_tree(id) AS (
        SELECT id FROM Tags WHERE name = ? COLLATE NOCASE
        UNION ALL
        SELECT t.id FROM Tags t JOIN tag_tree tt ON t.pid = tt.id
      )
      SELECT id FROM tag_tree
    `, [tagFilter]).map(r => r.id as number);

    if (!tagIds.length) {
      onLog(`ERROR: Tag "${tagFilter}" not found in DigiKam DB.`);
      dkDb.close();
      return { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: 0 };
    }
    onLog(`Tag "${tagFilter}": matched ${tagIds.length} tag(s) including sub-tags.`);
  }

  const conditions: string[] = ['i.status = 1', 'i.category = 1'];
  const params: (string | number | null)[] = [];

  if (albumFilter) {
    const prefix = albumFilter.endsWith('/') ? albumFilter : albumFilter + '/';
    conditions.push('(a.relativePath = ? OR a.relativePath LIKE ?)');
    params.push(albumFilter, prefix + '%');
  }

  if (tagIds.length) {
    conditions.push(`i.id IN (SELECT imageid FROM ImageTags WHERE tagid IN (${tagIds.map(() => '?').join(',')}))`);
    params.push(...tagIds);
  }

  if (!opts.includeNoGps && !opts.inferGps) {
    conditions.push('ip.latitudeNumber IS NOT NULL');
  }

  const whereClause = conditions.map(c => `(${c})`).join(' AND ');

  const rows = dkCollectRows(dkDb, `
    SELECT
      i.id AS dk_id, i.name AS filename, a.relativePath AS album_path,
      ip.latitudeNumber AS lat, ip.longitudeNumber AS lng,
      ii.creationDate AS taken_at, im.make AS camera_make, im.model AS camera_model,
      ii.width, ii.height
    FROM Images i
    JOIN Albums a ON i.album = a.id
    LEFT JOIN ImagePositions ip   ON i.id = ip.imageid
    LEFT JOIN ImageInformation ii ON i.id = ii.imageid
    LEFT JOIN ImageMetadata im    ON i.id = im.imageid
    WHERE ${whereClause}
    ORDER BY ii.creationDate
  `, params);

  dkDb.close();

  onLog(`Found ${rows.length} image(s)${albumFilter ? ` under "${albumFilter}"` : ''}${tagFilter ? ` tagged "${tagFilter}"` : ''}.`);
  if (!rows.length) return { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: 0 };

  let geoRef: GeoPoint[] = [];
  if (opts.inferGps) {
    geoRef = rows
      .filter(r => r.lat != null && r.lng != null && r.taken_at)
      .map(r => ({
        ts:  new Date(r.taken_at as string),
        lat: r.lat as number,
        lng: r.lng as number,
      }))
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    onLog(`GPS inference: ${geoRef.length} geotagged reference photo(s) available.`);
  }

  const collectionId = getOrCreateCollection(collectionName, opts.dryRun);
  const stats: ImportStats = { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: rows.length };
  let done = 0, lastPersist = 0;

  await runPool(rows, async (row) => {
    if (isCancelled?.()) return;
    const relPath  = (row.album_path as string).replace(/^\//, '');
    const filePath = path.join(dkRoot, relPath, row.filename as string);
    onProgress(done, rows.length, 'Importing');

    if (!fs.existsSync(filePath)) {
      onLog(`MISSING: ${row.filename as string} (${filePath})`);
      stats.missing++;
      done++;
      return;
    }

    const exif: ExifResult = {
      latitude:  row.lat  != null ? row.lat  as number : undefined,
      longitude: row.lng  != null ? row.lng  as number : undefined,
      timestamp: row.taken_at ? new Date(row.taken_at as string) : undefined,
      make:      row.camera_make  as string | undefined,
      model:     row.camera_model as string | undefined,
      width:     row.width  as number | undefined,
      height:    row.height as number | undefined,
    };

    const inferred = (!exif.latitude && opts.inferGps && exif.timestamp)
      ? findNearestGps(exif.timestamp, geoRef, opts.inferGpsWindowMs) ?? undefined
      : undefined;

    try {
      const status = await processFile(filePath, collectionId, exif, opts, inferred);
      if (status === 'imported') {
        stats.imported++;
        onLog(`imported: ${row.filename as string}${inferred ? ' (location inferred)' : ''}`);
      } else if (status === 'skipped') {
        stats.skipped++;
      } else if (status === 'no-gps') {
        stats.noGps++;
        onLog(`no-gps: ${row.filename as string}`);
      }
    } catch (err) {
      stats.errors++;
      onLog(`ERROR: ${row.filename as string}: ${err}`);
    }

    done++;
    if (!opts.dryRun && done - lastPersist >= PERSIST_EVERY) { persist(); lastPersist = done; }
  }, IMPORT_CONCURRENCY);

  if (!opts.dryRun) persist();
  if (isCancelled?.()) onLog(`Import cancelled after ${stats.imported} imported.`);
  return stats;
}

// ---- Photos (macOS PhotoKit helper) ----------------------------------------

export interface PhotosRecord {
  uuid:         string;
  lat:          number | null;
  lng:          number | null;
  takenAt:      string | null;
  filePath:     string | null;
  width:        number;
  height:       number;
  thumbWritten: boolean;
  error:        string | null;
}

function processPhotosRecord(
  rec:          PhotosRecord,
  collectionId: number,
  opts:         ImportOptions,
): 'imported' | 'skipped' | 'no-gps' {
  // Use real file path when available; fall back to stable photos:// URI for iCloud-only
  const filePath = rec.filePath ?? `photos://${rec.uuid}`;
  if (alreadyImported(filePath)) return 'skipped';

  const lat = rec.lat ?? null;
  const lng = rec.lng ?? null;
  if (lat === null && !opts.includeNoGps) return 'no-gps';

  const timestamp = rec.takenAt ?? new Date().toISOString();
  const precision = rec.takenAt ? 'second' : 'day';

  if (opts.dryRun) return 'imported';

  const thumbPath = rec.thumbWritten
    ? path.join(opts.thumbsDir, `${rec.uuid}.jpg`)
    : null;

  dbInsertPhoto({
    collectionId,
    filePath,
    thumbPath,
    latitude:  lat,
    longitude: lng,
    timestamp,
    precision,
    title:    rec.uuid.slice(0, 8),
    make:     null,
    model:    null,
    width:    rec.width  || null,
    height:   rec.height || null,
    exifJson: JSON.stringify({ photosUuid: rec.uuid, locationSource: lat ? 'gps' : 'none' }),
  });

  return 'imported';
}

export async function runPhotosImport(
  helperPath:     string,
  albumId:        string | undefined,
  collectionName: string,
  opts:           ImportOptions,
  onLog:          (msg: string) => void,
  onProgress:     (done: number, total: number, phase: string) => void,
  isCancelled?:   () => boolean,
): Promise<ImportStats> {
  return new Promise((resolve, reject) => {
    const helperArgs = ['import-photos', opts.thumbsDir];
    if (albumId) helperArgs.push(albumId);

    const proc   = spawn(helperPath, helperArgs);
    const stats: ImportStats = { imported: 0, skipped: 0, noGps: 0, missing: 0, errors: 0, total: 0 };
    let done        = 0;
    let lastPersist = 0;
    let buffer      = '';
    let headerSeen  = false;

    const collectionId = getOrCreateCollection(collectionName, opts.dryRun);

    proc.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const raw of lines) {
        const line = raw.trim();
        if (!line) continue;

        if (!headerSeen && line.startsWith('TOTAL ')) {
          stats.total = parseInt(line.slice(6), 10);
          onLog(`Found ${stats.total} photo(s) in Photos library.`);
          headerSeen = true;
          continue;
        }

        if (isCancelled?.()) { proc.kill(); return; }

        try {
          const rec = JSON.parse(line) as PhotosRecord;
          if (rec.error) {
            stats.errors++;
            onLog(`ERROR: ${rec.uuid}: ${rec.error}`);
          } else {
            const status = processPhotosRecord(rec, collectionId, opts);
            if (status === 'imported') {
              stats.imported++;
              const date = rec.takenAt ? rec.takenAt.slice(0, 10) : 'no date';
              onLog(`imported: ${rec.uuid.slice(0, 8)}… (${date})`);
            } else if (status === 'skipped') {
              stats.skipped++;
            } else if (status === 'no-gps') {
              stats.noGps++;
            }
          }
          done++;
          onProgress(done, stats.total || done, 'Importing');
          if (!opts.dryRun && done - lastPersist >= PERSIST_EVERY) {
            persist();
            lastPersist = done;
          }
        } catch (e) {
          stats.errors++;
          onLog(`ERROR parsing record: ${e}`);
        }
      }
    });

    proc.stderr.on('data', (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg === 'permission-denied') {
        proc.kill();
        reject(new Error(
          'Photos access denied. Go to System Settings → Privacy & Security → Photos and allow TimeMap.',
        ));
      } else if (msg === 'album-not-found') {
        proc.kill();
        reject(new Error('Album not found in Photos library.'));
      } else if (msg) {
        onLog(`[helper] ${msg}`);
      }
    });

    proc.on('close', () => {
      if (!opts.dryRun) persist();
      if (isCancelled?.()) onLog(`Import cancelled after ${stats.imported} imported.`);
      stats.total = Math.max(stats.total, done);
      resolve(stats);
    });

    proc.on('error', (err: Error) => {
      reject(new Error(`Could not start photos helper: ${err.message}`));
    });
  });
}
