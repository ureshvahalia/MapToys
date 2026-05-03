import { app, BrowserWindow, Menu, shell } from 'electron';
import path from 'node:path';

// Use an uncommon port to avoid collisions with the dev backend (3001)
const PORT = 3721;

// Resolve a path inside the packaged app or the development project root.
// In dev:  __dirname = electron/dist/  →  ../../ = project root
// In prod: app.getAppPath() = resources/app/  (electron-builder layout)
function resourcePath(...parts: string[]): string {
  const base = app.isPackaged
    ? app.getAppPath()
    : path.join(__dirname, '../..');
  return path.join(base, ...parts);
}

let win: BrowserWindow | null = null;

async function launchServer(): Promise<void> {
  const entry     = resourcePath('backend', 'dist', 'index.js');
  const staticDir = resourcePath('frontend', 'dist');

  // Dynamic require so the absolute path is resolved at runtime.
  // The backend resolves its own dependencies (express, sharp, etc.)
  // from the node_modules/ sitting alongside it in resources/app/.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require(entry) as {
    startServer: (opts: { port: number; staticDir: string }) => Promise<void>;
  };
  await mod.startServer({ port: PORT, staticDir });
}

function openWindow(url: string): void {
  win = new BrowserWindow({
    width:     1280,
    height:    800,
    minWidth:  900,
    minHeight: 600,
    title:     'TimeMap',
    backgroundColor: '#0a0d18',
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  void win.loadURL(url);

  // Only show the window once content is ready to avoid a blank flash
  win.once('ready-to-show', () => win?.show());

  win.webContents.setWindowOpenHandler(({ url: u }) => {
    // Photo API URLs are served locally — open in an Electron popup so the
    // user stays in the app.  All other links (e.g. external hrefs) go to
    // the system browser.
    if (/localhost:\d+\/api\/photos\/\d+$/.test(u)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          width: 1280,
          height: 960,
          title: 'TimeMap — Photo',
          backgroundColor: '#0a0d18',
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
          },
        },
      };
    }
    void shell.openExternal(u);
    return { action: 'deny' };
  });

  win.on('closed', () => { win = null; });
}

async function main(): Promise<void> {
  await app.whenReady();

  // Remove the default menu bar on Windows/Linux (macOS keeps the global menu bar)
  if (process.platform !== 'darwin') Menu.setApplicationMenu(null);

  const url = app.isPackaged
    ? `http://localhost:${PORT}`
    : 'http://localhost:5173';  // dev: point at the running Vite dev server

  if (app.isPackaged) {
    await launchServer();
  }

  openWindow(url);

  // macOS: clicking the dock icon re-opens the window if it was closed
  app.on('activate', () => {
    if (win === null) openWindow(url);
    else win.show();
  });
}

// Quit when all windows are closed, except on macOS where apps stay in the dock
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

main().catch((err: unknown) => {
  console.error('Fatal error starting TimeMap:', err);
  app.quit();
});
