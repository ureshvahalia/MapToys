import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

export interface FsEntry {
  name:  string;
  path:  string;
  isDir: boolean;
}

export interface FsListResult {
  current: string;
  parent:  string | null;
  entries: FsEntry[];
}

export function fsRouter(): Router {
  const router = Router();

  // GET /api/fs/list?path=<dir>&mode=directory|file&ext=.db
  router.get('/list', (req, res) => {
    const dir  = (req.query.path as string) || os.homedir();
    const mode = (req.query.mode as string) || 'directory';
    const ext  = (req.query.ext  as string) || '';

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err: unknown) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
      return;
    }

    const dirs: FsEntry[] = entries
      .filter(e => e.isDirectory() && !e.name.startsWith('.'))
      .map(e => ({ name: e.name, path: path.join(dir, e.name), isDir: true }))
      .sort((a, b) => a.name.localeCompare(b.name));

    const files: FsEntry[] = mode === 'file'
      ? entries
          .filter(e => e.isFile() && (!ext || e.name.toLowerCase().endsWith(ext.toLowerCase())))
          .map(e => ({ name: e.name, path: path.join(dir, e.name), isDir: false }))
          .sort((a, b) => a.name.localeCompare(b.name))
      : [];

    const resolved = path.resolve(dir);
    const parentPath = path.dirname(resolved);

    const result: FsListResult = {
      current: resolved,
      parent:  parentPath !== resolved ? parentPath : null,
      entries: [...dirs, ...files],
    };

    res.json(result);
  });

  return router;
}
