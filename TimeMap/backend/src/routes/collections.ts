import { Router } from 'express';
import { queryAll } from '../db/connection';

interface CollectionRow {
  id: number;
  name: string;
  description: string;
  created_at: string;
  artifact_count: number;
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

  return router;
}
