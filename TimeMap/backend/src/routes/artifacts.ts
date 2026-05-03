import { Router } from 'express';
import { queryArtifactsInViewport } from '../db/queries';
import { queryOne } from '../db/connection';

interface ArtifactRow {
  id:             number;
  artifact_type:  string;
  timestamp:      string;
  title:          string | null;
  description:    string | null;
  latitude:       number;
  longitude:      number;
  camera_make:    string | null;
  camera_model:   string | null;
  thumbnail_path: string | null;
}

export function artifactsRouter(): Router {
  const router = Router();

  router.get('/:id', (req, res) => {
    const id = Number(req.params.id);
    const row = queryOne<ArtifactRow>(
      `SELECT a.id, a.artifact_type, a.timestamp, a.title, a.description,
              a.latitude, a.longitude,
              p.camera_make, p.camera_model, p.thumbnail_path
       FROM artifacts a
       LEFT JOIN photos p ON p.artifact_id = a.id
       WHERE a.id = ?`,
      [id],
    );
    if (!row) { res.status(404).json({ error: 'Not found' }); return; }
    res.json({
      id:             row.id,
      artifact_type:  row.artifact_type,
      timestamp:      row.timestamp,
      title:          row.title,
      description:    row.description,
      latitude:       row.latitude,
      longitude:      row.longitude,
      camera_make:    row.camera_make,
      camera_model:   row.camera_model,
      thumbnail_path: row.thumbnail_path ? `/api/photos/${row.id}/thumbnail` : null,
    });
  });

  router.get('/', (req, res) => {
    const { minLat, maxLat, minLng, maxLng, windowStart, windowEnd, collectionId } = req.query;

    if (
      typeof minLat      !== 'string' || typeof maxLat    !== 'string' ||
      typeof minLng      !== 'string' || typeof maxLng    !== 'string' ||
      typeof windowStart !== 'string' || typeof windowEnd !== 'string'
    ) {
      res.status(400).json({ error: 'Missing or invalid query parameters' });
      return;
    }

    try {
      const rows = queryArtifactsInViewport({
        minLat:       Number(minLat),
        maxLat:       Number(maxLat),
        minLng:       Number(minLng),
        maxLng:       Number(maxLng),
        windowStart,
        windowEnd,
        collectionId: typeof collectionId === 'string' ? Number(collectionId) : undefined,
      });

      res.json({
        type: 'FeatureCollection',
        features: rows.map(row => ({
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [row.longitude, row.latitude] },
          properties: {
            id:             row.id,
            artifact_type:  row.artifact_type,
            timestamp:      row.timestamp,
            title:          row.title,
            description:    row.description,
            latitude:       row.latitude,
            longitude:      row.longitude,
            camera_make:    row.camera_make,
            camera_model:   row.camera_model,
            thumbnail_path: row.thumbnail_path
              ? `/api/photos/${row.id}/thumbnail`
              : null,
          },
        })),
      });
    } catch (err) {
      console.error('Artifact query error:', err);
      res.status(500).json({ error: 'Database error' });
    }
  });

  return router;
}
