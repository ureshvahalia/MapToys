# TimeMap

A desktop application for exploring your photo collection on a world map, filtered by time. Photos are pinned at the GPS coordinates where they were taken and revealed through an interactive timeline — watch your memories unfold across the globe.

## Installation

Download the latest installer for your platform from the [Releases](../../releases) page. No other software is required.

- **Windows** — run `TimeMap-Setup-x.x.x.exe` and follow the prompts
- **macOS (Apple Silicon)** — open `TimeMap-x.x.x-arm64.dmg`, drag `TimeMap.app` to the Applications folder, then eject the disk image
- **macOS (Intel)** — open `TimeMap-x.x.x.dmg`, drag `TimeMap.app` to the Applications folder, then eject the disk image

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

## Using the Timeline

The timeline bar runs along one edge of the screen. It shows the full span of time across your imported photos, and a blue highlighted window marks which part of that span is currently visible on the map.

### Zooming in and out

**Scroll the mouse wheel** over the timeline to zoom. Scrolling up zooms in (narrowing the time range), scrolling down zooms out (widening it). The zoom pivots around whichever point on the timeline is under your cursor, so you can aim at a specific decade or year to keep it centred.

The timeline can zoom all the way from a view spanning centuries down to individual minutes. Tick marks and labels adjust automatically as you zoom.

**Double-click** anywhere on the timeline to reset the zoom back to the default full view.

### Scrolling through time

To scroll forward or backward through time without changing the zoom level, **click and drag on the track background** — the part of the timeline that is outside the blue window. Dragging left moves earlier in time; dragging right moves later.

### The blue selection window

The blue window defines the active time range. Only photos whose timestamp falls inside it appear on the map.

The window has three draggable parts:

- **Center area** — drag to slide the entire window forward or backward while keeping its size (time span) unchanged. The window cannot be dragged past the edges of the current view.
- **Left/top handle** (circle at the start of the window) — drag to move the start of the range independently, expanding or shrinking the window from one end.
- **Right/bottom handle** (circle at the end of the window) — drag to move the end of the range independently.

The two handles cannot cross each other, so the window always represents a valid time range. There is no snapping — the handles move freely and continuously.

### Moving the timeline to a different edge

The timeline can be docked to any edge of the screen.

- **Drag method** — click and hold the grip icon (the six-dot handle at the side of the bar) and drag it toward any screen edge. A ghost outline shows where the timeline will land; release to snap it there.
- **Arrow buttons** — hover over the timeline to reveal four arrow buttons. Click one to instantly move the timeline to that edge.

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
