import { Router } from 'express';
import { queryArtifactsInViewport } from '../db/queries';

export function artifactsRouter(): Router {
  const router = Router();

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
