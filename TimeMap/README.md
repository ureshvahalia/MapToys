# TimeMap

A desktop application for exploring your photo collection on a world map, filtered by time. Photos are pinned at the GPS coordinates where they were taken and revealed through an interactive timeline — watch your memories unfold across the globe.

## Installation

Download the latest installer for your platform from the [Releases](../../releases) page. No other software is required.

- **Windows** — run `TimeMap-Setup-x.x.x.exe` and follow the prompts
- **macOS** — open the `.zip`, drag `TimeMap.app` to your Applications folder

## Features

### Map & Visualization
- **Globe and Mercator projections** — toggle between a 3-D globe and a flat map
- **Zoomable timeline** — zoom from centuries down to individual minutes; drag the active window to filter which photos appear on the map
- **Spatial clustering** — nearby photos cluster automatically with a count badge; hover to see the time span, click to zoom in
- **Timeline edge** — dock the timeline to the top, bottom, left, or right edge of the screen

### Photo Import
- **Folder import** — point TimeMap at any folder; it recursively finds photos and reads their GPS coordinates, timestamps, and camera details from EXIF data
- **DigiKam integration** — import directly from a DigiKam library, with optional filtering by album or tag
- **GPS inference** — photos without GPS can optionally inherit approximate coordinates from nearby geotagged photos in the same import
- **Supported formats** — JPEG, PNG, TIFF, WebP, HEIC/HEIF, and RAW formats (CR2, CR3, NEF, ARW, DNG, and others)

### Photo Detail
- Full-size photo viewer with EXIF metadata: timestamp, camera make/model, GPS coordinates, dimensions, description, and tags
- Previous/next navigation to browse photos chronologically
- Link to open the original file in your system's default viewer

### Collections
- Each import creates a named collection; multiple collections coexist on the same map
- Manage collections from the sidebar: view source paths, photo counts, and import dates
- Reset (wipe) all imported data from the settings panel

---

## What TimeMap Stores on Your System

TimeMap creates one folder in your home directory to keep its working data:

```
~/.timemap/
├── timemap.db    ← index of your photos (file paths, GPS, timestamps, camera info)
└── thumbs/       ← small preview images generated from your photos
```

On Windows this is typically `C:\Users\<your-username>\.timemap\`.

**Important:** TimeMap never copies, moves, or modifies your original photo files. The database (`timemap.db`) stores only references to where your photos live on disk, along with metadata read from them (GPS coordinates, timestamps, camera make/model, etc.). The `thumbs/` folder holds small JPEG previews (400 px wide) generated during import for fast display — not copies of your photos.

The total size of the `.timemap` folder depends on how many photos you import. The database itself is small (typically a few MB even for large libraries); thumbnails take roughly 20–50 KB each.

TimeMap also saves one window preference (which edge the timeline is docked to) in local app storage. This is removed when you uninstall.

---

## Uninstalling

Uninstalling TimeMap removes the application but leaves your data folder in place so you don't lose your import history if you reinstall later. To remove everything completely, follow both steps below.

### Step 1 — Remove the application

**Windows:** Go to *Settings → Apps → Installed apps*, find **TimeMap**, and click **Uninstall**.

**macOS:** Drag `TimeMap.app` from your Applications folder to the Trash.

### Step 2 — Delete the data folder

This removes the photo index and all cached previews. Your original photos are not affected.

**Windows** — open PowerShell and run:
```powershell
Remove-Item -Recurse -Force "$env:USERPROFILE\.timemap"
```

**macOS / Linux:**
```bash
rm -rf ~/.timemap
```

After these two steps, TimeMap leaves no files on your system.

---

## For Developers

The project is structured as three npm packages under one root:

```
TimeMap/
├── frontend/    ← React + MapLibre GL (Vite)
├── backend/     ← Node.js + Express + sql.js
└── electron/    ← Electron shell
```

```bash
npm run install:all   # install all dependencies
npm run dev           # start frontend (port 5173) + backend (port 3001)
npm run build:all     # production build of all three packages
npm run dist:win      # package Windows installer
npm run dist:mac      # package macOS app
npm run typecheck     # TypeScript checks across frontend + backend
```

Map tiles are served by [OpenFreeMap](https://openfreemap.org) — no API key required.

---

## License

MIT
