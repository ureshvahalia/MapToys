/**
 * Photo import CLI
 *
 * Folder scan:
 *   npx ts-node src/scripts/import.ts --source /path/to/photos --collection "Name"
 *   npx ts-node src/scripts/import.ts --source /path/to/photos --collection "Name" --infer-gps
 *   npx ts-node src/scripts/import.ts --source /path/to/photos --collection "Name" --include-no-gps
 *
 * DigiKam:
 *   npx ts-node src/scripts/import.ts --list-albums --digikam /path/to/digikam4.db
 *   npx ts-node src/scripts/import.ts --digikam /path/to/digikam4.db --digikam-root /path/to/photos \
 *     --collection "Name" [--album /2024/Italy] [--tag Keepers] [--infer-gps]
 *
 * Other:
 *   npx ts-node src/scripts/import.ts --rescan [--collection "Name"]
 *   Add --dry-run to any command to preview without writing.
 */

import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { openDb, getDb } from '../db/connection';
import { initDb } from '../db/schema';
import {
  runFolderImport,
  runDigikamImport,
  listDigikamAlbums,
  type ImportOptions,
  type ImportStats,
} from '../lib/importer';

// ---- Config ------------------------------------------------------------------

const DATA_DIR   = process.env.TIMEMAP_DATA_DIR ?? path.join(os.homedir(), '.timemap');
const DB_PATH    = path.join(DATA_DIR, 'timemap.db');
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

// ---- Arg parsing -------------------------------------------------------------

const args       = process.argv.slice(2);
const getArg     = (f: string) => { const i = args.indexOf(f); return i !== -1 ? args[i + 1] : undefined; };
const hasFlag    = (f: string) => args.includes(f);

const sourceDir      = getArg('--source');
const digikamPath    = getArg('--digikam');
const digikamRoot    = getArg('--digikam-root');
const collectionName = getArg('--collection');
const albumFilter    = getArg('--album');
const tagFilter      = getArg('--tag');
const inferGpsWinMin = parseInt(getArg('--infer-gps-window') ?? '30', 10);

const dryRun      = hasFlag('--dry-run');
const includeNoGps = hasFlag('--include-no-gps');
const inferGps    = hasFlag('--infer-gps');
const rescan      = hasFlag('--rescan');
const listAlbums  = hasFlag('--list-albums');

// ---- Rescan -----------------------------------------------------------------

async function runRescan(name: string | undefined) {
  const db = getDb();
  const result = name
    ? db.exec(`
        SELECT p.artifact_id, p.file_path FROM photos p
        JOIN artifacts a ON a.id = p.artifact_id
        JOIN collections c ON c.id = a.collection_id
        WHERE c.name = ?`, [name])
    : db.exec('SELECT artifact_id, file_path FROM photos');

  if (!result.length) { console.log('Nothing to rescan.'); return; }
  const { values } = result[0];
  let missing = 0;
  for (const [id, fp] of values) {
    if (!fs.existsSync(fp as string)) { console.log(`MISSING id=${id}: ${fp}`); missing++; }
  }
  console.log(`Rescan complete. ${values.length} record(s) checked, ${missing} missing.`);
}

// ---- Summary ----------------------------------------------------------------

function printSummary(stats: ImportStats) {
  console.log(`\nDone (${stats.total} file(s) processed).`);
  console.log(`  Imported : ${stats.imported}`);
  if (stats.skipped) console.log(`  Skipped  : ${stats.skipped} (already in DB)`);
  if (stats.noGps)   console.log(`  No GPS   : ${stats.noGps}${inferGps ? ' (no nearby reference within window)' : ' (use --infer-gps or --include-no-gps)'}`);
  if (stats.missing) console.log(`  Missing  : ${stats.missing} (file path could not be resolved)`);
  if (stats.errors)  console.log(`  Errors   : ${stats.errors}`);
}

// ---- Progress callbacks -----------------------------------------------------

let lastProgressLine = '';
const onLog = (msg: string) => {
  if (lastProgressLine) { process.stdout.write('\n'); lastProgressLine = ''; }
  console.log(msg);
};
const onProgress = (done: number, total: number, phase: string) => {
  const line = `\r  ${phase}: ${done}/${total}`;
  process.stdout.write(line);
  lastProgressLine = line;
};

// ---- Main -------------------------------------------------------------------

async function main() {
  fs.mkdirSync(DATA_DIR,   { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  if (listAlbums) {
    if (!digikamPath) { console.error('Error: --list-albums requires --digikam <path>'); process.exit(1); }
    const albums = await listDigikamAlbums(digikamPath);
    console.log(`\nAlbums in ${digikamPath}:\n`);
    console.log('  Count  Path');
    console.log('  -----  ----');
    for (const a of albums) console.log(`  ${String(a.photoCount).padStart(5)}  ${a.path}`);
    console.log(`\nUse --album <path> to filter, e.g. --album /2024/Italy`);
    return;
  }

  await openDb(DB_PATH);
  initDb(getDb());

  if (rescan) { await runRescan(collectionName); return; }

  if (!collectionName) { console.error('Error: --collection <name> is required.'); process.exit(1); }

  const opts: ImportOptions = {
    dryRun, includeNoGps, inferGps,
    inferGpsWindowMs: inferGpsWinMin * 60 * 1000,
    thumbsDir: THUMBS_DIR,
  };

  if (sourceDir) {
    if (!fs.existsSync(sourceDir)) { console.error(`Source not found: ${sourceDir}`); process.exit(1); }
    const stats = await runFolderImport(sourceDir, collectionName, opts, onLog, onProgress);
    if (lastProgressLine) process.stdout.write('\n');
    printSummary(stats);
    return;
  }

  if (digikamPath) {
    if (!fs.existsSync(digikamPath)) { console.error(`DigiKam DB not found: ${digikamPath}`); process.exit(1); }
    if (!digikamRoot) {
      console.error('Error: --digikam-root <path> is required with --digikam.');
      process.exit(1);
    }
    const stats = await runDigikamImport(
      digikamPath, digikamRoot, collectionName, opts,
      albumFilter, tagFilter, onLog, onProgress,
    );
    if (lastProgressLine) process.stdout.write('\n');
    printSummary(stats);
    return;
  }

  console.error('Error: specify --source <dir> or --digikam <db-path>.');
  process.exit(1);
}

main().catch(err => { console.error(err); process.exit(1); });
