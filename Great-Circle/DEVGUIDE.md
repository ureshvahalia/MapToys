# Antipode Map — Developer Guide

## Table of Contents
1. [Project Overview](#1-project-overview)
2. [Design and Architecture Choices](#2-design-and-architecture-choices)
3. [Project Structure](#3-project-structure)
4. [Local Development](#4-local-development)
5. [First-Time VPS Setup](#5-first-time-vps-setup)
6. [Vercel Deployment](#6-vercel-deployment-one-time-setup)
7. [Deploying Updates](#7-deploying-updates)
8. [Future Todos](#8-future-todos)

---

## 1. Project Overview

A web application that displays an interactive world map (globe or flat Mercator view), lets the user select locations by clicking or searching, shows the antipodal point of any selected location, and plans multi-stop great-circle routes with per-segment and total distances.

**Live URL:** https://apps.vahalia.com/antipode/  
**Home page:** https://apps.vahalia.com  
**Repository:** https://github.com/ureshvahalia/antipode-map

---

## 2. Design and Architecture Choices

### Map Engine — MapLibre GL JS
**Chosen over:** Google Maps, Mapbox  
**Why:** MapLibre is an open-source fork of Mapbox GL JS (forked when Mapbox changed to a proprietary license). It supports native globe projection (`setProjection({ type: 'globe' })`), which Google Maps does not. It is free with no API key required.  
**Version:** v5 — note that v5 changed `setProjection` to require an object `{ type: 'globe' }` rather than a plain string.

### Map Tiles — OpenFreeMap
**Chosen over:** Stadia Maps, Google Maps, self-hosted  
**Why:** Stadia Maps changed their pricing model and no longer offers an unconditional free tier (they have a 2-week trial then require account configuration per domain). OpenFreeMap is completely free, requires no account or API key, and works from any domain including localhost. It uses OpenStreetMap data and serves the same vector tile format MapLibre expects.  
**Style URL:** `https://tiles.openfreemap.org/styles/liberty`  
**Switching tiles later:** change the single `MAP_STYLE` constant in `src/App.tsx`.

### Geocoding — Nominatim (OpenStreetMap)
**Why:** Free, no API key, no account, works from any domain. Sufficient for personal/low-traffic use.  
**Rate limit:** 1 request/second — handled by 350ms debounce in `LocationInput.tsx`.  
**Switching to paid later:** all geocoding is abstracted behind `src/services/geocoding.ts`. Swapping to Stadia Maps (Pelias) or another provider is a one-function change. Stadia's autocomplete endpoint is `https://geocoding.stadiamaps.com/autocomplete?text=QUERY&api_key=KEY`.

### Geospatial Math — Turf.js
- `@turf/great-circle` — generates great-circle arc as GeoJSON for route rendering
- `@turf/distance` — computes haversine distance between two points
- `@turf/helpers` — `point()` and `featureCollection()` utilities

### Drag-to-Reorder — @dnd-kit
**Why:** The current standard React drag-and-drop library. `react-beautiful-dnd` is deprecated. @dnd-kit is accessible, well-maintained, and works with pointer events (important for touch/mobile later).

### Framework — React + TypeScript + Vite
**Why:** The team knows JavaScript/HTML. TypeScript adds type safety for coordinate math (easy to confuse `[lng, lat]` vs `[lat, lng]`). Vite provides a fast dev server and modern build pipeline.

### Antipodal Overlay — Two Stacked MapLibre Instances
The "looking through the Earth" effect is achieved by rendering two MapLibre maps in the same container:
- **Map 1 (main):** fully interactive, z-index 0
- **Map 2 (antipodal):** `interactive: false`, `opacity: 0.28`, `pointer-events: none`, z-index 1

Map 2 is always centered at the antipodal of Map 1's center: `(lng ± 180, -lat)`.

**Critical CSS fix:** `transform: scaleY(-1)` is applied to the antipodal container. Without it, north-south panning appears reversed. This is because the antipodal latitude is negated — when Map 1 moves north, Map 2's center moves south. The vertical flip makes the rendering track in the same visual direction.

The overlay is hidden (`display: none`) when a destination is set, replaced by the route display.

### iOS Path (Planned)
Capacitor wraps the built web app into a native iOS shell with no code changes:
```bash
npm install @capacitor/core @capacitor/cli @capacitor/ios
npx cap init
npx cap add ios
npx cap sync
# Then open in Xcode and build
```

---

## 3. Project Structure

```
Project1/
  src/
    App.tsx                  # Main component: two maps, markers, route layer, state
    App.css                  # Map layout, antipodal overlay, info box
    index.css                # Full-height reset for html/body/#root
    main.tsx                 # React entry point
    types.ts                 # Shared types: Location, WaypointSlot, Unit, FocusedField
    services/
      geocoding.ts           # Nominatim search + reverse geocode (swap provider here)
    utils/
      geo.ts                 # calcAntipode, buildRoute, calcDistances, computeGlobeZoom
    components/
      LocationInput.tsx      # Autocomplete input with keyboard navigation
      LocationInput.css
      LocationPanel.tsx      # Floating panel: inputs, distances, settings, clear all
      LocationPanel.css
  dist/                      # Production build output (gitignored) — deploy this
  DEVGUIDE.md                # This file
  vite.config.ts             # base path read from VITE_BASE_PATH env var (default '/')

apps-home/                   # Separate from the React app
  index.html                 # Home page for apps.vahalia.com
```

### Key State and Refs in App.tsx

| Name | Type | Purpose |
|---|---|---|
| `mainMap` | ref | Primary MapLibre instance |
| `antipodeMap` | ref | Antipodal ghost MapLibre instance |
| `markers` | ref `Map<string, Marker>` | All map markers keyed by role |
| `focusedField` | ref | Which input the next map click fills |
| `originRef/destinationRef/waypointSlotsRef` | refs | Mirror of state for use in async click handler |
| `origin/destination` | state | Placed locations |
| `waypointSlots` | state | Array of `WaypointSlot` (can contain null location) |
| `distances` | state | Computed per-segment distances |
| `unit` | state | `'km'` or `'miles'`, persisted to localStorage |
| `infoDismissed` | state | Whether user dismissed the intro box, persisted to localStorage |

---

## 4. Local Development

### Prerequisites
- Node.js 18+
- npm 10+

### Install and run
```bash
cd Project1
npm install
npm run dev -- --host
```
Open `http://localhost:5173` (port may increment if in use).

### Build
```bash
npm run build
# Output goes to dist/
```

### Type check
```bash
npx tsc --noEmit
```

### Notes
- Map tiles load from OpenFreeMap — internet connection required even for local dev
- Nominatim geocoding requires internet access
- `localStorage` keys used: `unit`, `info-dismissed`

---

## 5. First-Time VPS Setup

**Server:** Ubuntu VPS running Apache2  
**Domain:** apps.vahalia.com  
**Files served from:** `/var/www/apps/`

### Step 1 — DNS
At your registrar (Squarespace), add an A record:
- Name: `apps`
- Value: VPS public IP address
- TTL: 3600

### Step 2 — Server dependencies
```bash
sudo apt update
sudo apt install -y certbot python3-certbot-apache
```

### Step 3 — Create site root
```bash
sudo mkdir -p /var/www/apps/antipode
sudo chown -R vahalia:vahalia /var/www/apps
```

### Step 4 — Apache virtual host
```bash
sudo tee /etc/apache2/sites-available/apps.vahalia.com.conf << 'EOF'
<VirtualHost *:80>
    ServerName apps.vahalia.com
    DocumentRoot /var/www/apps

    <Directory /var/www/apps>
        Options -Indexes
        AllowOverride None
        Require all granted
    </Directory>

    ErrorLog  ${APACHE_LOG_DIR}/apps-error.log
    CustomLog ${APACHE_LOG_DIR}/apps-access.log combined
</VirtualHost>
EOF

sudo a2ensite apps.vahalia.com.conf
sudo apache2ctl configtest && sudo systemctl reload apache2
```

Note: `sudo cat > file` does not work for root-owned directories — use `sudo tee` instead.

### Step 5 — Deploy files (after DNS propagates)
From local WSL terminal in the project root (`/mnt/e/SoftwareDev/Maps/`):
```bash
cd Project1
npm run build
rsync -avz --delete dist/ vahalia@VPS_IP:/var/www/apps/antipode/
rsync -avz ../apps-home/index.html vahalia@VPS_IP:/var/www/apps/
```

### Step 6 — SSL
```bash
sudo certbot --apache -d apps.vahalia.com
# Choose option 2 (redirect HTTP → HTTPS)
```
Certbot auto-renews via a systemd timer — no manual action needed.

### Verify
- https://apps.vahalia.com — home page
- https://apps.vahalia.com/antipode/ — app

---

## 6. Vercel Deployment (one-time setup)

Vercel auto-deploys on every push to `main`. No environment variables are needed — `VITE_BASE_PATH` defaults to `/` so the app sits at the domain root.

### Steps (done once)
1. Go to **vercel.com** and sign in with your GitHub account
2. Click **Add New Project** → **Import Git Repository**
3. Select the `antipode-map` repository
4. Vercel auto-detects Vite — leave all build settings as-is:
   - Framework: Vite
   - Build command: `npm run build`
   - Output directory: `dist`
5. Click **Deploy**

After the first deploy, every `git push origin main` triggers a new deployment automatically. The live URL will be `antipode-map.vercel.app` (or a custom domain if configured later).

---

## 7. Deploying Updates

### App changes
```bash
cd Project1
VITE_BASE_PATH=/antipode/ npm run build
rsync -avz --delete dist/ vahalia@VPS_IP:/var/www/apps/antipode/
```

### Home page changes only
```bash
rsync -avz ../apps-home/index.html vahalia@VPS_IP:/var/www/apps/
```

### Both
```bash
cd Project1
VITE_BASE_PATH=/antipode/ npm run build
rsync -avz --delete dist/ vahalia@VPS_IP:/var/www/apps/antipode/
rsync -avz ../apps-home/index.html vahalia@VPS_IP:/var/www/apps/
```

### Note on base paths
`vite.config.ts` reads `VITE_BASE_PATH` from the environment at build time.
- VPS build: set `VITE_BASE_PATH=/antipode/` (app lives in a subdirectory)
- Vercel build: no variable needed — defaults to `/` (app is at the domain root)

### Commit to git
```bash
git add .
git commit -m "Description of changes"
git push origin main
```

---

## 7. Future Todos

### High priority
- **iOS deployment via Capacitor** — framework already chosen, see Section 2 for steps. Requires Apple Developer account ($99/year) for App Store; TestFlight is free for limited distribution.
- **deploy.sh script** — wrap build + both rsync commands into a single script to reduce friction.

### Geocoding
- **Upgrade to paid geocoding** if Nominatim feels slow or results are poor. Stadia Maps (Pelias) has a proper autocomplete endpoint and is the natural next step. Change is isolated to `src/services/geocoding.ts`.
- **Nominatim rate limiting** — at higher traffic, consider proxying Nominatim requests through the VPS to control rate and add caching.

### CI/CD
- **GitHub Actions** — set up a workflow that runs `npm run build` and rsyncs to the VPS automatically on every push to `main`. Eliminates the manual deploy steps entirely.

### Performance
- **Bundle size** — the production JS bundle is ~1.3MB (mainly MapLibre GL JS). Vite warns about this. Add dynamic `import()` to code-split Turf.js and other large dependencies if load time becomes a concern.

### Map and features
- **Terrain/topography tiles** — OpenFreeMap's liberty style has good city/border detail but limited terrain shading. Maptiler's free tier (100k requests/month) provides richer terrain tiles and can be layered in for topographic detail.
- **Stadia Maps authentication** — if switching back to Stadia tiles (better outdoors style), register the `apps.vahalia.com` domain in the Stadia Maps dashboard and store the API key as a Vite environment variable (`VITE_STADIA_KEY` in `.env.local`, never committed).
- **Antipodal overlay opacity** — currently 28%; may want a slider in settings.
- **Info box reset** — "Clear All" resets the map but not the info box dismissal. Could add a "Show intro" button to settings if users want to re-read it.
- **Phase 3 features** — TBD based on user requirements.
