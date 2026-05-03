# TimeMap

A desktop application for exploring your photo collection as a four-dimensional world map — the fourth dimension being time. Photos are pinned at the GPS coordinates where they were taken and filtered by an interactive timeline, letting you watch your memories unfold across the globe.

## Features

### Map & Visualization
- **Globe and Mercator projections** — toggle between a 3-D globe and a flat map
- **Zoomable timeline** — zoom from centuries down to individual minutes; drag the active window to filter which photos appear on the map
- **Spatial clustering** — nearby photos automatically cluster with a count badge; hover to see the time span, click to zoom in
- **Timeline edge** — dock the timeline to the top, bottom, left, or right edge of the screen

### Photo Import
- **Folder import** — point TimeMap at any folder; it recursively finds photos and extracts GPS coordinates, timestamps, and camera metadata from EXIF
- **DigiKam integration** — import directly from a DigiKam SQLite database, with optional filtering by album or tag
- **GPS inference** — photos without GPS can optionally inherit approximate coordinates from nearby geotagged photos in the same import
- **Supported formats** — JPEG, PNG, TIFF, WebP, HEIC/HEIF, and RAW formats (CR2, CR3, NEF, ARW, DNG, and others)

### Photo Detail
- Full-size photo viewer with EXIF metadata: timestamp, camera make/model, GPS coordinates, dimensions, description, and tags
- Previous/next navigation to browse photos chronologically
- External link to open the original file

### Collections
- Each import creates a named collection; multiple collections coexist on the same map
- Manage collections from the sidebar: view source paths, artifact counts, and creation dates
- Reset (wipe) the entire database from the settings panel

---

## What TimeMap Stores on Your System

TimeMap creates one directory in your home folder:

```
~/.timemap/
├── timemap.db      # SQLite database (photos, collections, metadata)
└── thumbs/         # JPEG thumbnail cache (400 px, generated on import)
```

On Windows this is typically `C:\Users\<your-username>\.timemap\`.  
On macOS/Linux it is `~/.timemap/`.

You can redirect storage to a different location by setting the `TIMEMAP_DATA_DIR` environment variable before starting the app.

The app also stores one UI preference (`timeline-edge`) in your browser's `localStorage`. This is cleared automatically if you reset the app.

TimeMap does **not** modify, move, or copy your original photo files.

---

## Installation

### Prerequisites
- [Node.js](https://nodejs.org/) 18 or later
- npm (included with Node.js)

### Run from source

```bash
# Clone the repository
git clone https://github.com/ureshvahalia/MapToys.git
cd MapToys/TimeMap

# Install all dependencies (frontend, backend, Electron)
npm run install:all

# Start the development servers
npm run dev
```

The frontend opens at `http://localhost:5173` and proxies API calls to the backend at `http://localhost:3001`.

### Windows convenience scripts

```powershell
# Start both servers (logs written to backend.log / frontend.log)
.\start.ps1

# Stop all TimeMap processes
.\stop.ps1
```

### Build a distributable

```bash
# Build everything (frontend + backend + Electron shell)
npm run build:all

# Package for the current platform
npm run dist

# Package for Windows (.exe installer)
npm run dist:win

# Package for macOS (.zip)
npm run dist:mac
```

The packaged app bundles its own backend server (port 3721) and serves the frontend from it — no separate Node.js installation is required on the end-user machine.

---

## Available Scripts

| Script | Description |
|---|---|
| `npm run dev` | Start frontend + backend concurrently (development) |
| `npm run install:all` | Install dependencies for all three packages |
| `npm run build` | Build the React frontend |
| `npm run build:backend` | Compile backend TypeScript |
| `npm run build:electron` | Compile Electron main process |
| `npm run build:all` | Build all three |
| `npm run electron:dev` | Build and launch the Electron app in dev mode |
| `npm run dist` | Build + package for current platform |
| `npm run dist:win` | Build + package for Windows |
| `npm run dist:mac` | Build + package for macOS |
| `npm run typecheck` | Run TypeScript type checks on frontend and backend |

---

## Configuration

| Environment variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | Backend HTTP port (dev mode) |
| `TIMEMAP_DATA_DIR` | `~/.timemap` | Directory for the database and thumbnail cache |

---

## Uninstalling

### 1. Remove the application

**Windows (packaged app):**  
Go to *Settings → Apps → Installed apps*, find **TimeMap**, and click **Uninstall**.

**macOS (packaged app):**  
Drag `TimeMap.app` from your Applications folder to the Trash.

**Source installation:**  
Simply delete the cloned repository folder.

### 2. Remove all data files (leaves no footprint)

Delete the `.timemap` directory from your home folder:

**Windows (PowerShell):**
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.timemap"
```

**macOS / Linux:**
```bash
rm -rf ~/.timemap
```

This permanently removes the database and all cached thumbnails. Your original photo files are untouched.

### 3. Clear the UI preference (optional)

If you ran TimeMap in a browser-based dev session, one key (`timeline-edge`) may remain in that browser's `localStorage`. You can clear it from the browser developer console:

```js
localStorage.removeItem('timeline-edge')
```

---

## Technology

| Layer | Stack |
|---|---|
| Frontend | React 18, TypeScript, Vite, MapLibre GL JS v5, D3 (timeline math) |
| Backend | Node.js, Express, sql.js (SQLite/WASM), sharp (thumbnails), exifr (EXIF) |
| Desktop | Electron 35, electron-builder |
| Map tiles | [OpenFreeMap](https://openfreemap.org) (Liberty style, no API key required) |

---

## License

MIT
