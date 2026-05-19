# TimeMap — Developer Guide

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Architecture](#2-architecture)
3. [Technology Choices](#3-technology-choices)
4. [Project Structure](#4-project-structure)
5. [Local Development](#5-local-development)
6. [WSL Development Notes](#6-wsl-development-notes)
7. [Database](#7-database)
8. [Deployment](#8-deployment)
9. [Status & Remaining Work](#9-status--remaining-work)

---

## 1. Project Overview

A 4-dimensional interactive world map. The fourth dimension is time, controlled by a zoomable timeline track. Phase 1 displays geo-tagged photographs at their GPS coordinates, filtered by an adjustable time window.

**Related project:** Great-Circle (antipode map) — same map engine, tile provider, and frontend stack.

---

## 2. Architecture

TimeMap is a two-process application:

```
frontend/   React + Vite dev server   http://localhost:5173
backend/    Express + sql.js           http://localhost:3001
```

In development, Vite proxies all `/api/*` requests to the backend (configured in `frontend/vite.config.ts`). In production, Express would serve the built frontend static files as well.

The backend is the only process that touches the database and photo files. The frontend never reads files directly — it fetches artifacts via the REST API and loads photos via the `/api/photos/:id` streaming endpoint.

---

## 3. Technology Choices

### Map Engine — MapLibre GL JS v5
Same choice as Great-Circle. See Great-Circle's DEVGUIDE for rationale.  
**Note:** `setProjection({ type: 'globe' })` must be called inside the map's `load` event in v5, not immediately after construction.

### Map Tiles — OpenFreeMap
Same as Great-Circle. Style URL: `https://tiles.openfreemap.org/styles/liberty`

### Frontend — React + TypeScript + Vite
Same as Great-Circle.

### Database — sql.js (SQLite compiled to WebAssembly)
**Chosen over:** `better-sqlite3` (native C++ addon)  
**Why:** `better-sqlite3` is a native C++ module that must be compiled for the host platform. On WSL, where the project lives on a Windows filesystem (`/mnt/e/`), Windows `npm` installs the Windows binary, which the Linux Node.js runtime cannot load. `sql.js` is pure JavaScript + WebAssembly — no native compilation, installs correctly with any `npm`, runs on any Node.js regardless of how packages were installed.  
**Trade-off:** `sql.js` loads the entire database into memory and requires an explicit `persist()` call to write changes back to disk. For a personal photo library (queries at browse time, writes only during import), this is immaterial.  
**DigiKam compatibility:** DigiKam's `digikam4.db` is a standard SQLite 3 file. `sql.js` reads it identically to any other SQLite library — no special handling required.

### Backend Runtime — ts-node + ts-node-dev
**Chosen over:** `tsx` (esbuild-based TypeScript runner)  
**Why:** `tsx` depends on `esbuild`, which is a native binary with the same WSL platform issue as `better-sqlite3`. `ts-node` uses TypeScript's own compiler API (pure JavaScript) — no platform-specific binaries at all.  
**Dev workflow:** `ts-node-dev --respawn --poll` watches source files and restarts the server on changes. The `--poll` flag is required because inotify file-watching does not work on the Windows filesystem (`/mnt/e/`) — see [Section 6](#6-wsl-development-notes).

### Thumbnail and Preview Generation — sharp + heic-convert
**sharp** handles thumbnail generation (400px, during import) and on-demand JPEG preview generation (1200px max, cached to `~/.timemap/previews/`).  
**HEIC support:** sharp includes libheif in its pre-built Linux binaries and handles most HEIC/HEIF files. However, some iPhone photos use the HEVC codec variant that the bundled libheif cannot decode.  
**heic-convert fallback:** for HEIC files that sharp rejects, `heic-convert` (a WASM HEVC decoder) is used as a fallback. It is slower but handles all HEIC variants.  
**WSL2 seeking workaround:** sharp can fail on large files on the Windows filesystem (`/mnt/e/`) due to filesystem seeking behaviour. Both `makeThumbnail` and `buildPreview` read the source file into a Node.js Buffer first and pass the Buffer to sharp, avoiding this issue. The Buffer is also reused for the heic-convert fallback, so the file is only read once regardless of which path is taken.  
**Install:** sharp downloads platform-specific pre-built binaries at install time. Use Linux npm (nvm) to install the Linux binary. Windows npm installs the Windows binary which the Linux Node.js runtime cannot use; the `fix-wsl-binaries.js` script does **not** cover sharp.

### Clustering — MapLibre built-in (Supercluster)
MapLibre's GeoJSON source has a `cluster: true` option that runs Supercluster internally. No extra library needed — the cluster → dot expansion on zoom is handled by MapLibre automatically.

### Timeline Component — Custom React + d3-scale
The zoomable, re-orientable timeline has no off-the-shelf equivalent that fits the design. Built as a custom SVG component using `d3-scale` for time-axis math and standard React pointer-event handlers for drag interaction.

### Import concurrency — Node.js libuv thread pool
The import pipeline runs files through a `runPool` worker pool with `IMPORT_CONCURRENCY = 4` concurrent workers (matching Node.js's default libuv thread pool size). This allows up to 4 sharp thumbnail operations to run simultaneously in native threads. The synchronous sql.js DB operations (`alreadyImported`, `dbInsertPhoto`) serialize naturally in the JS event loop — there are no awaits between the duplicate check and the insert, so the check-then-insert is atomic.

---

## 4. Project Structure

```
TimeMap/
  frontend/
    src/
      App.tsx                  # Map init, projection toggle, timeline layout, import button
      App.css
      index.css                # Full-height reset
      main.tsx
      types.ts                 # Shared types: TrackEdge, TimeWindow, Artifact, etc.
      services/
        api.ts                 # Typed fetch wrappers for all backend endpoints (artifacts,
                               #   photos, import jobs, filesystem browser)
      components/
        TimelineTrack/
          TimelineTrack.tsx    # Zoomable timeline — axis, range handles, drag-to-edge
          TimelineTrack.css
        DetailPanel/
          DetailPanel.tsx      # Full-size photo + EXIF metadata, prev/next navigation
          DetailPanel.css
        ImportPanel/
          ImportPanel.tsx      # Web import UI — folder/DigiKam tabs, job progress,
                               #   cancel button, reset DB, reload map
          ImportPanel.css
        FileBrowser/
          FileBrowser.tsx      # Server-side filesystem browser modal (used by ImportPanel)
          FileBrowser.css
    vite.config.ts             # Proxies /api → backend:3001; polling for WSL file watching
    tsconfig.json
    package.json

  backend/
    src/
      index.ts                 # Express server entry; async DB init; route wiring
      db/
        connection.ts          # sql.js wrapper: openDb, persist, queryAll, queryOne, execute
        schema.ts              # CREATE TABLE / CREATE INDEX statements
        queries.ts             # Typed query functions (artifacts viewport query, etc.)
      lib/
        importer.ts            # Shared import logic: EXIF reading, GPS inference, thumbnail
                               #   generation, folder import, DigiKam import, runPool helper.
                               #   Used by both the CLI script and the web import route.
      routes/
        artifacts.ts           # GET /api/artifacts?bbox+window → GeoJSON FeatureCollection
        photos.ts              # GET /api/photos/:id  :id/thumbnail  :id/preview (cached)
        collections.ts         # GET /api/collections
        import.ts              # POST /api/import/start   GET /api/import/jobs/:id
                               # POST /api/import/jobs/:id/cancel
                               # GET  /api/import/albums?digikam=<path>
                               # POST /api/import/reload  POST /api/import/reset
        fs.ts                  # GET /api/fs/list?path=&mode=directory|file&ext=
      scripts/
        import.ts              # CLI import tool — thin wrapper around lib/importer.ts
      types/
        heic-convert.d.ts      # Type declarations for heic-convert (no @types package)
    tsconfig.json
    package.json

  fix-wsl-binaries.js          # Downloads Linux native binaries after Windows npm install
  REQUIREMENTS.md
  DEVGUIDE.md                  # This file
```

---

## 5. Local Development

### Prerequisites
- Node.js 18+ (see WSL note below regarding which Node.js)
- npm 9+
- Internet connection (map tiles and initial `npm install` require it)

### First-time setup

```bash
# Install root convenience scripts (concurrently)
cd TimeMap
npm install

# Install frontend dependencies
cd frontend && npm install && cd ..

# Install backend dependencies
cd backend && npm install && cd ..
```

**On WSL:** after `npm install` in `frontend/`, run the platform fix script:
```bash
node fix-wsl-binaries.js frontend
```
See [Section 6](#6-wsl-development-notes) for why this is needed.

### Running in development

Use the start script (recommended):

```bash
cd TimeMap
./start.sh
```

Both processes start in the background. Logs go to `backend.log` and `frontend.log`.  
To stop: `kill $(cat .pids)`

Or manually in two terminals:

```bash
# Terminal 1 — backend (http://localhost:3001)
cd backend && npm run dev

# Terminal 2 — frontend (http://localhost:5173)
cd frontend && npm run dev
```

The frontend is available at **http://localhost:5173** from a Windows browser (WSL2 port-forwarding). If localhost is refused, use the WSL2 IP printed in `frontend.log`, e.g. `http://172.28.x.x:5173`.

### Type checking

```bash
cd frontend && npm run typecheck
cd backend  && npm run typecheck
```

---

## 6. WSL Development Notes

### The platform problem

The project source lives on the Windows filesystem (`/mnt/e/`). When `npm install` runs with the **Windows npm** (which is typically first on the `PATH` in WSL), it installs platform-specific native binaries for **Windows** (`win32-x64`). The Linux Node.js runtime cannot load these.

Affected packages in the frontend: `esbuild` (used by Vite) and `@rollup/rollup-*` (used by Vite's bundler).

The backend has two native-binary packages:
- **sharp** — image processing. Install via Linux npm (nvm); the fix script does not cover it.
- **heic-convert** — WASM-based HEVC decoder. Pure JavaScript + WASM, no platform-specific binary; installs correctly from any npm.

### Which Node.js / npm is active

```bash
which node   # should be /usr/bin/node (Linux)
which npm    # may be /mnt/c/Program Files/nodejs/npm (Windows) — this is the problematic one
node -e "console.log(process.platform)"  # should print: linux
```

If `npm` is the Windows one, frontend native binaries (and sharp) will be installed for the wrong platform.

### The fix script

After running `npm install` in `frontend/` from WSL, run:

```bash
node fix-wsl-binaries.js frontend
```

This downloads the correct `@esbuild/linux-x64` and `@rollup/rollup-linux-x64-gnu` binaries directly from the npm registry and places them alongside the Windows binaries. Both coexist; Linux Node.js finds the Linux one.

**You must re-run this script every time `npm install` is run in `frontend/`** (e.g., after adding a new dependency), because npm will overwrite the Linux binaries with the Windows ones.

**This script does not fix sharp.** Sharp must be installed via Linux npm (nvm) — see below.

### File watching on WSL

Both Vite and ts-node-dev use inotify for file watching, which does not work on the Windows filesystem (`/mnt/e/`).

- **Vite** — `vite.config.ts` enables polling (`usePolling: true`, 500ms interval). If edits still don't appear in the browser after restart, do a hard refresh (`Ctrl+Shift+R`).
- **ts-node-dev** — `backend/package.json` passes `--poll` to ts-node-dev. The backend will auto-restart on source changes. Without `--poll`, the backend would not detect edits and must be restarted manually.

### sharp WSL2 filesystem seeking

On WSL2, sharp can fail when given a file path on the Windows filesystem (`/mnt/e/`) due to seeking behaviour with large files. Both `makeThumbnail` (import) and `buildPreview` (preview endpoint) work around this by reading the source file into a Node.js `Buffer` first and passing the Buffer to sharp, rather than passing the path.

### Permanent fix (recommended)

Install a Linux npm via nvm. This eliminates the need for the fix script and correctly installs sharp:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

After this, `npm` will be the Linux npm and all packages install correctly for the Linux Node.js runtime. Note: nvm installs to `~/.nvm/` (Linux filesystem), so `npm install` for the backend will also work without issues.

### Running from Windows (no WSL)

```powershell
# PowerShell or cmd — from E:\SoftwareDev\Maps\TimeMap
cd frontend && npm install && npm run dev
cd ..\backend && npm install && npm run dev
```

No fix script needed — Windows npm installs Windows binaries, and the Windows Node.js runtime uses them correctly. Sharp will install the Windows binary and work correctly.

---

## 7. Database

### Location

The database, thumbnails, and preview cache live at `~/.timemap/` by default:

```
~/.timemap/
  timemap.db        ← SQLite database (artifact metadata, GPS, timestamps)
  thumbs/           ← Generated thumbnails — 400px JPEGs, named <artifact_id>.jpg
  previews/         ← On-demand preview cache — 1200px JPEGs, named <artifact_id>.jpg
```

Override the location by setting the `TIMEMAP_DATA_DIR` environment variable before starting the backend. All three directories are derived from this value.

### Persistence model

`sql.js` holds the database in memory and writes to disk on explicit `persist()` calls. The server calls `persist()` once at startup (to save the initial schema if the DB was just created). The import pipeline calls `persist()` every 50 files during import and once at the end.

**After a web UI import:** the map can be refreshed immediately by clicking "Reload map" in the ImportPanel — this calls `POST /api/import/reload` which re-reads the DB from disk, then triggers a map data re-fetch. No server restart required.

**After a CLI import:** restart the backend server, or call `POST /api/import/reload` directly (e.g. `curl -X POST http://localhost:3001/api/import/reload`).

### Schema overview

| Table | Purpose |
|---|---|
| `collections` | Named groups of artifacts (e.g., "Travels 2004") |
| `artifacts` | Core record: type, lat/lng, timestamp, tags, collection |
| `photos` | Photo-specific: file path, thumbnail path, EXIF fields |

The `artifacts` table is the central table. `photos` extends it via a 1:1 foreign key. Future artifact types (news clippings, events) each get their own extension table.

### Import CLI

```bash
cd backend

# Folder scan
npx ts-node src/scripts/import.ts --source /path/to/photos --collection "My Travels"
npx ts-node src/scripts/import.ts --source /path/to/photos --collection "My Travels" --infer-gps
npx ts-node src/scripts/import.ts --source /path/to/photos --collection "My Travels" --include-no-gps

# DigiKam — list albums first, then import
npx ts-node src/scripts/import.ts --list-albums --digikam /path/to/digikam4.db
npx ts-node src/scripts/import.ts --digikam /path/to/digikam4.db --digikam-root /path/to/photos \
  --collection "My Travels" [--album /2024/Italy] [--tag Keepers] [--infer-gps]

# Rescan existing records for missing files
npx ts-node src/scripts/import.ts --rescan [--collection "Name"]

# Add --dry-run to any command to preview without writing
```

The CLI and web UI share the same import logic in `backend/src/lib/importer.ts`. Both run files through a 4-worker concurrent pool and use the same Buffer-first sharp + heic-convert fallback for thumbnail generation.

### Deduplication

Photos are deduplicated by absolute file path (`photos.file_path`). Reimporting the same directory, or importing overlapping directories, is safe — already-imported files are skipped. Cross-deduplication between folder and DigiKam imports also works correctly as long as the DigiKam `--digikam-root` path resolves to the same filesystem location.

### Import API endpoints

| Endpoint | Description |
|---|---|
| `POST /api/import/start` | Start a folder or DigiKam import job; returns `{ jobId }` |
| `GET /api/import/jobs/:id` | Poll job status, progress, and log |
| `POST /api/import/jobs/:id/cancel` | Request cancellation; import stops after the current file |
| `GET /api/import/albums?digikam=<path>` | List albums from a DigiKam DB file |
| `POST /api/import/reload` | Reload the in-memory DB from disk |
| `POST /api/import/reset` | Delete all artifacts, collections, thumbnails, and previews |

---

## 8. Deployment

### Releasing a new version

Use the release script from the `TimeMap/` directory (Windows PowerShell):

```powershell
.\release.ps1 1.0.4
```

This script:
1. Bumps `electron/package.json` to the new version and commits it
2. Pushes the commit to `main`
3. Creates and pushes a `v1.0.4` tag, which triggers the GitHub Actions build

Track the build: `gh run watch`

When CI succeeds, the GitHub Release for `v1.0.4` will have three artifacts attached:
- `TimeMap-Setup-1.0.4.exe` — Windows NSIS installer
- `TimeMap-1.0.4-arm64.dmg` — macOS Apple Silicon, signed + notarized
- `TimeMap-1.0.4.dmg` — macOS Intel, signed + notarized

### CI build pipeline

The workflow is at `.github/workflows/build-timemap.yml`. For each platform it:

1. Installs all dependencies (`npm run install:all`)
2. Syncs the version number from the git tag into `electron/package.json`
3. **macOS only:** imports the Developer ID Application certificate into a temporary keychain
4. **macOS only:** compiles `electron/photos-helper.swift` and signs the binary with `electron/build/entitlements.helper.plist` (Photos library entitlement only)
5. Runs `npm run dist:mac` or `npm run dist:win` — electron-builder signs the `.app` via the keychain
6. **macOS only:** submits each `.dmg` to Apple's notarytool, waits for approval, then staples the notarization ticket to the DMG
7. Attaches all artifacts to the GitHub Release

### macOS code signing — GitHub secrets required

| Secret | Value |
|---|---|
| `MACOS_CERT_P12` | Base64-encoded Developer ID Application `.p12` certificate |
| `MACOS_CERT_PASSWORD` | Password set when exporting the `.p12` |
| `APPLE_ID` | Apple ID email address |
| `APPLE_APP_PASSWORD` | App-specific password from appleid.apple.com |
| `APPLE_TEAM_ID` | Team ID from developer.apple.com → Membership |

To base64-encode the `.p12` on WSL:
```bash
base64 -w 0 DeveloperIDApplication.p12 | clip.exe
```

The Developer ID Application certificate is shared with WatchNext — the same `.p12` and credentials work for both projects.

### Key signing files

| File | Purpose |
|---|---|
| `electron/build/entitlements.mac.plist` | Main app entitlements: JIT, unsigned memory, Photos library |
| `electron/build/entitlements.helper.plist` | Swift helper entitlements: Photos library only |
| `electron/notarize.js` | afterSign hook stub (currently bypassed — notarization runs in CI after DMG creation) |

### VPS deployment (Phase 2)

Same VPS as Great-Circle (`apps.vahalia.com`), target path `apps.vahalia.com/timemap/`.

Deployment differs from Great-Circle because of the backend process:
- The backend needs to run persistently (PM2 or systemd service)
- `TIMEMAP_DATA_DIR` should point to a persistent server path
- Photo files must be accessible from the server (either uploaded or mounted)

Detailed VPS setup instructions will be added when Phase 2 begins.

---

## 9. Status & Remaining Work

### Done
- **TimelineTrack** — zoomable (scroll-wheel), range handles (left/right drag), center drag to pan window, background drag to pan view, drag-to-edge repositioning with ghost preview, edge-switcher buttons, horizontal/vertical orientation, double-click to reset zoom. Drag handling uses document-level capture listeners (`capture: true`) to prevent MapLibre from stealing pointer events.
- **Artifact layer** — MapLibre GeoJSON source with Supercluster clustering, circle layers for dots and clusters, cluster count labels, hover popup with thumbnail + title + date.
- **Detail panel** — click a dot to open full-size photo with EXIF metadata (date, camera, GPS), prev/next navigation by time, blurred thumbnail placeholder while preview loads.
- **Cluster click** — zooms map to fit the cluster's bounding box.
- **Preview caching** — `GET /api/photos/:id/preview` generates a 1200px JPEG on first request and caches it to `~/.timemap/previews/`. Preview read-ahead prefetches visible dots at zoom > 12.
- **Photo import CLI** (`backend/src/scripts/import.ts`) — folder scan with EXIF reading (`exifr`), DigiKam DB integration, GPS inference for non-geotagged photos, thumbnail generation (`sharp` + `heic-convert` fallback), dry-run mode, rescan command.
- **Import shared library** (`backend/src/lib/importer.ts`) — all import logic extracted from the CLI into a reusable module with `onLog`/`onProgress`/`isCancelled` callbacks. Used by both the CLI and the web import route.
- **Web import UI** (`ImportPanel`) — folder scan and DigiKam import from the browser. Features: path inputs with server-side FileBrowser modal, DigiKam album browser, GPS inference and no-GPS options, dry-run mode, live progress bar and log, cancel button, post-import "Reload map" button, reset database button (clears all artifacts + thumbnails + previews).
- **FileBrowser component** — server-side filesystem browser (`GET /api/fs/list`) used by ImportPanel to navigate to source directories and DigiKam DB files.
- **Import job system** — async in-memory job store on the backend; frontend polls at 500ms. Jobs have `running / done / cancelled / error` states with partial stats preserved on cancellation.
- **DB reload endpoint** — `POST /api/import/reload` reloads the in-memory DB from disk without a server restart.
- **DB reset endpoint** — `POST /api/import/reset` wipes all collections, artifacts, thumbnails, and previews.
- **Parallel import** — 4-worker pool (`runPool`) in `lib/importer.ts`; EXIF reading and thumbnail generation run concurrently across 4 files at a time.
- **Buffer-first image reads** — both `makeThumbnail` and `buildPreview` read source files into a Node.js Buffer before passing to sharp, working around WSL2 filesystem seeking issues on `/mnt/e/`.
- **ts-node-dev `--poll`** — backend auto-restarts on source file changes without requiring inotify (works on Windows filesystem).
- **WSL dev setup** — `start.sh` launches both processes in the background with log files; `vite.config.ts` uses `host: '0.0.0.0'` and polling for WSL file watching.

### Remaining — high priority
- **Cluster hover** — tooltip showing count + time range summary (e.g. "42 photos · 2018–2022"). Currently only the count label renders.
- **Timeline keyboard input** — allow typing exact dates for the window start/end and view bounds.

### Remaining — medium priority
- **Timeline playback** — Play button that advances the window forward in time at a configurable speed.
- **Collection / tag / text filters** — filter panel composable with the time window.

### Remaining — Phase 2 / later
- **VPS deployment** — build step, PM2/systemd service, `TIMEMAP_DATA_DIR` config, path prefix (`/timemap/`) setup.
- **nvm permanent fix** — install Linux npm via nvm to eliminate the `fix-wsl-binaries.js` script entirely.
