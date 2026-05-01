# TimeMap — Requirements

## 1. Project Overview

A 4-dimensional interactive world map application where the fourth dimension is **time**. The map displays geo-tagged artifacts (photographs, news clippings, events, etc.) at their geographic coordinates, filtered and animated by a zoomable time-range control. It is designed as a general framework capable of hosting multiple artifact types and multiple use-case applications on top of a shared core.

**Phase 1 artifact type:** Photographs (with EXIF GPS + timestamp extraction).

---

## 2. Time Control

### 2.1 Zoomable timeline track
The time control is a timeline bar that behaves like a zoomable chart axis:

- **Zoom in/out** — scroll wheel (or pinch on trackpad) zooms the timeline, changing the visible date span (e.g., zoomed out: "entire 20th century"; zoomed in: "May–August 1975"). The axis tick labels and grid lines update to match the current zoom level (decades → years → months → days → hours → minutes).
- **Pan** — click-drag on empty track space scrolls the visible time window along its axis.
- The track's visible start and end are user-controlled (not automatically locked to data bounds), and can also be set via keyboard input fields.

#### Repositionable and re-orientable
The timeline track can be dragged to any edge of the map viewport:

- **Left or right edge** — track renders vertically; time flows top-to-bottom. Works well for globe view on a wide desktop screen.
- **Top or bottom edge** — track renders horizontally; time flows left-to-right. Works well for narrow/phone viewports or flat Mercator view.

The user repositions the track by dragging it (from a drag handle or its label area) toward any edge; it snaps to the nearest edge on release and re-orients automatically. The last position and orientation are persisted in `localStorage` so the layout is restored on next launch.

On first launch, the track defaults to the **bottom edge** (horizontal) as a safe default across all viewport sizes.

### 2.2 Active window (range selector)
Within the zoomed timeline track, a **range selector** marks the active time window — the span of time for which artifacts are shown on the map:

- Two **bracket handles** (the two edges of the window along the track axis) that can be dragged independently.
- A **center bar** between the handles that can be dragged to shift the window without changing its width.
- The window's start, end, and width are shown in human-readable text (e.g., "1973–1977 (4 years)" or "Mar–Sep 2004 (6 months)").
- All values (track bounds and window bounds) can be set via keyboard input as well as mouse.

### 2.3 Granularity
Granularity is not a separate user control — it is implied by the current zoom level of the timeline track. As the user zooms in, tick marks refine from years → months → days → hours. The range handles snap to the current implied unit.

### 2.4 Playback
A **Play** button animates the window position forward in time, advancing by one snap unit per step at a configurable speed. A second click pauses playback.

---

## 3. Map Display

### 3.1 Base map
- Interactive world map with user-togglable flat (Mercator) and globe projections.
- Consistent with Great-Circle project: **MapLibre GL JS** + **OpenFreeMap** tiles.
- Full pan, zoom, and rotation.

### 3.2 Artifact rendering
Only artifacts whose timestamp falls within the **active time window** and whose coordinates fall within the **visible viewport** are rendered.

- **Single-artifact dot** — a small WebGL circle at the artifact's coordinates (rendered via MapLibre GeoJSON source + circle layer, not DOM elements, for performance at scale).
- **Cluster marker** — when multiple artifacts are spatially close at the current zoom, they collapse into a cluster circle showing a count. MapLibre's built-in GeoJSON clustering (backed by Supercluster) handles this automatically.

### 3.3 Cluster interaction
- **Hover** — tooltip shows count and time range summary (e.g., "42 photos · 1962–1969").
- **Click** — map zooms to fit the cluster's bounding box, splitting it into dots or sub-clusters.

### 3.4 Single-dot interaction
- **Hover** — thumbnail image preview + timestamp + location name.
- **Click** — opens a detail panel/modal with: full-size photo, EXIF metadata (date, location, camera), description, tags, and prev/next navigation by time.

### 3.5 Viewport filtering
Only artifacts in the current viewport are fetched/rendered. Panning or zooming triggers an incremental update. The cluster and dot layers update together.

---

## 4. Database / Data Model

### 4.1 Core artifact table
Every artifact, regardless of type, has:

| Field | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `artifact_type` | TEXT | `'photo'`, `'news_clipping'`, `'event'`, … |
| `latitude` | REAL | WGS-84 |
| `longitude` | REAL | WGS-84 |
| `timestamp` | TEXT (ISO 8601 UTC) | The point in time the artifact represents |
| `timestamp_precision` | TEXT | `'year'`, `'month'`, `'day'`, `'hour'`, `'minute'`, `'second'` |
| `title` | TEXT | Short display label |
| `description` | TEXT | Free-text notes |
| `tags` | TEXT | JSON array of strings |
| `collection_id` | INTEGER FK | Groups artifacts into named collections |

### 4.2 Photo extension table (`photos`)

| Field | Type | Description |
|---|---|---|
| `artifact_id` | INTEGER FK | References `artifacts.id` |
| `file_path` | TEXT | Absolute path to the original image file |
| `thumbnail_path` | TEXT | Path to generated thumbnail (cached) |
| `width` | INTEGER | Pixels |
| `height` | INTEGER | Pixels |
| `camera_make` | TEXT | EXIF `Make` |
| `camera_model` | TEXT | EXIF `Model` |
| `exif_json` | TEXT | Full EXIF blob (JSON) for reference |

### 4.3 Collections table

| Field | Type | Description |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `name` | TEXT | Display name |
| `description` | TEXT | Notes |
| `created_at` | TEXT | ISO 8601 |

### 4.4 Database format
**SQLite** — single file, portable, no server process. Stored at a configurable path (default: `~/.timemap/timemap.db`).

---

## 5. Photo Import / Ingestion

### 5.1 Supported sources
Two ingestion modes, selectable at import time:

**A. Folder scan** — user points the importer at a root folder; it recursively scans all JPEG/HEIC/PNG/RAW files, extracts EXIF GPS and timestamp, and inserts records into the DB. Files are **referenced by path** — not copied. If photos move, a rescan/rebuild corrects paths.

**B. DigiKam integration** — DigiKam stores its catalog in a SQLite file (`digikam4.db`). The importer can read that DB directly to extract file paths, GPS coordinates, timestamps, and tags already entered in DigiKam, without re-scanning EXIF from scratch.

### 5.2 Rescan / rebuild
A **rescan** command checks all existing DB records for moved or deleted files, updates paths where possible (by matching filename + EXIF hash), and flags unresolvable records. A full **rebuild** drops all photo records for a collection and re-imports from source.

### 5.3 Ingestion UX
- **CLI** — `npx ts-node src/scripts/import.ts --source /path/to/photos --collection "Travels"` (or `--digikam`). Simple and reliable for local setup.
- **Web UI** — ImportPanel in the browser: folder scan or DigiKam DB, server-side filesystem browser for path selection, live progress log, cancel button, post-import map reload, and database reset. Implemented in Phase 1.

### 5.4 EXIF extraction
Uses **exifr** — a lightweight async EXIF parser supporting JPEG, HEIC, RAW formats, and standard EXIF fields including GPS and timestamp. DigiKam imports read metadata directly from the DigiKam SQLite DB rather than re-parsing EXIF from disk.

### 5.5 Thumbnail and preview generation
On import, a thumbnail (max 400×400 px JPEG) is generated and stored in `~/.timemap/thumbs/`. A larger preview (max 1200×1200 px JPEG) is generated on-demand when a photo is opened in the detail panel and cached in `~/.timemap/previews/`.

Both use **sharp** for image processing with a **heic-convert** (WASM) fallback for HEIC files that sharp cannot decode.

---

## 6. Filtering and Search

In addition to the time window:
- **Collection filter** — dropdown to select one or more collections.
- **Tag filter** — chip-based multi-tag filter (OR within tags).
- **Text search** — search title and description; matching dots are highlighted.

All active filters are composable (AND logic).

---

## 7. Deployment Modes

### Mode 1 — Fully local
- User runs a local Node.js backend (`npm start` or a packaged binary).
- Frontend served by the same process at `http://localhost:PORT`.
- SQLite DB and photo files both on the local machine.
- No internet required after initial tile cache (or if offline tiles are bundled).

### Mode 2 — VPS-hosted (Phase 2)
- The full stack (frontend + backend + SQLite) is deployed to the VPS.
- Photos are uploaded to the VPS (or accessible via a mounted path).
- Multiple users each have their own DB file, namespaced by a simple config or per-user directory.
- No login required in Phase 1 (single-user, personal); basic auth or token in Phase 2.
- Accessible at `apps.vahalia.com/timemap/` (consistent with existing VPS setup).

---

## 8. General Framework Design

The application is structured as a reusable core with pluggable artifact types:

- **Core layer:** map engine, time slider, clustering, filter panel, viewport query engine.
- **Artifact plugin interface:** each type registers a DB schema extension, a dot style, a hover card renderer, and a detail view renderer.
- Adding a new artifact type (e.g., news clippings) requires implementing the plugin interface only — no changes to core.

---

## 9. Non-Functional Requirements

| Requirement | Target |
|---|---|
| Map dot performance | Smooth at 10,000+ visible dots (MapLibre WebGL circle layer) |
| Cluster recalculation | ≤ 100ms on zoom/pan (Supercluster, client-side) |
| Photo import speed | 1,000 photos with EXIF in < 60 seconds |
| Thumbnail generation | Background/async, non-blocking |
| Offline operation | All imported photos and thumbnails work without internet |
| DB portability | Single `.db` file can be copied to another machine |

---

## 10. Out of Scope (Phase 1)

- Real-time data streams.
- Multi-user collaboration or shared collections.
- Mobile-native app (Capacitor path available later).
- News clippings / events artifact type.
- VPS deployment (local Mode 1 first).

---

## 11. Resolved Decisions

| Question | Decision |
|---|---|
| Project name | TimeMap |
| First artifact type | Photos |
| Storage | SQLite via sql.js (pure JS/WASM — no native modules) |
| Photo organization | DigiKam or folder scan, user's choice per import |
| Ingestion UX | CLI + web UI both in Phase 1 |
| Auth | None in Phase 1 (personal tool) |
| Map view | Flat + globe, user-togglable |
| Granularity control | Implied by timeline zoom level (no separate dropdown) |
| Timeline track bounds | User-controlled (zoom/pan + keyboard input) |
| Deployment | Local (Mode 1) first; VPS (Mode 2) as Phase 2 option |
| SQLite library | sql.js over better-sqlite3 — avoids native module platform conflict on WSL |
| TypeScript runner | ts-node over tsx — avoids esbuild native binary platform conflict on WSL |
| Image processing | sharp (pre-built Linux binaries, HEIC via libheif) + heic-convert fallback (WASM HEVC decoder) for HEIC files sharp cannot decode |
| EXIF parsing | exifr (pure JS, async) — sufficient for GPS + timestamp extraction; DigiKam imports read from the DigiKam DB directly |
| File watching | ts-node-dev `--poll` + Vite `usePolling` — inotify doesn't work on /mnt/e/ in WSL2 |
| Import concurrency | 4-worker pool in lib/importer.ts — matches Node.js libuv thread pool default, parallelises sharp thumbnail generation |
| Import deduplication | Absolute file path as the unique key — safe for re-imports and cross-source deduplication |
| Web import UI | Server-side filesystem browser (GET /api/fs/list) — avoids browser file-picker limitations; lets users navigate to any path the server can read |

---

## 12. Development Platform Notes

The project source lives on a Windows filesystem (`/mnt/e/`) and is developed from WSL. This creates a specific constraint: Windows `npm` installs Windows-platform native binaries, but the Linux Node.js runtime cannot load them.

**Backend:** redesigned to use zero native modules. Installs and runs correctly from any npm on any platform with no workaround.

**Frontend:** Vite's dependencies (esbuild, Rollup) are native binaries. After `npm install` in `frontend/` from WSL, run:
```bash
node fix-wsl-binaries.js frontend
```

Full details, permanent fix options, and Windows-native workflow: see [DEVGUIDE.md — Section 6](DEVGUIDE.md#6-wsl-development-notes).
