import path from 'node:path';
import { Router } from 'express';
import { queryAll } from '../db/connection';

interface CollectionRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  artifact_count: number;
}

interface FilePathRow {
  collection_id: number;
  file_path: string;
}

export function collectionsRouter(): Router {
  const router = Router();

  router.get('/', (_req, res) => {
    const rows = queryAll<CollectionRow>(`
      SELECT c.id, c.name, c.description, c.created_at,
             COUNT(a.id) AS artifact_count
      FROM collections c
      LEFT JOIN artifacts a ON a.collection_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `);
    res.json(rows);
  });

  router.get('/overview', (_req, res) => {
    const collections = queryAll<CollectionRow>(`
      SELECT c.id, c.name, c.description, c.created_at,
             COUNT(a.id) AS artifact_count
      FROM collections c
      LEFT JOIN artifacts a ON a.collection_id = c.id
      GROUP BY c.id
      ORDER BY c.name
    `);

    const filePaths = queryAll<FilePathRow>(`
      SELECT a.collection_id, p.file_path
      FROM artifacts a
      JOIN photos p ON p.artifact_id = a.id
    `);

    const dirMap = new Map<number, Map<string, number>>();
    for (const { collection_id, file_path } of filePaths) {
      if (!dirMap.has(collection_id)) dirMap.set(collection_id, new Map());
      const dir = path.dirname(file_path);
      const m = dirMap.get(collection_id)!;
      m.set(dir, (m.get(dir) ?? 0) + 1);
    }

    const result = collections.map(c => ({
      ...c,
      sources: Array.from(dirMap.get(c.id)?.entries() ?? [])
        .map(([directory, count]) => ({ directory, count }))
        .sort((a, b) => a.directory.localeCompare(b.directory)),
    }));

    res.json(result);
  });

  return router;
}
