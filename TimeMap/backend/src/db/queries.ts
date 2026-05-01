import { queryAll } from './connection';

export interface ArtifactRow {
  id: number;
  artifact_type: string;
  latitude: number;
  longitude: number;
  timestamp: string;
  timestamp_precision: string;
  title: string;
  description: string;
  tags: string;
  collection_id: number | null;
  thumbnail_path: string | null;
  camera_make: string | null;
  camera_model: string | null;
}

export interface ViewportQuery {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  windowStart: string;
  windowEnd: string;
  collectionId?: number;
}

export function queryArtifactsInViewport(params: ViewportQuery): ArtifactRow[] {
  const lngClause = params.minLng > params.maxLng
    ? '(a.longitude >= ? OR a.longitude <= ?)'
    : 'a.longitude BETWEEN ? AND ?';

  const sql = `
    SELECT
      a.id, a.artifact_type, a.latitude, a.longitude, a.timestamp,
      a.timestamp_precision, a.title, a.description, a.tags, a.collection_id,
      p.thumbnail_path, p.camera_make, p.camera_model
    FROM artifacts a
    LEFT JOIN photos p ON p.artifact_id = a.id
    WHERE a.latitude  BETWEEN ? AND ?
      AND ${lngClause}
      AND a.timestamp BETWEEN ? AND ?
      ${params.collectionId != null ? 'AND a.collection_id = ?' : ''}
    ORDER BY a.timestamp
    LIMIT 10000
  `;

  const bindParams = [
    params.minLat, params.maxLat,
    params.minLng, params.maxLng,
    params.windowStart, params.windowEnd,
    ...(params.collectionId != null ? [params.collectionId] : []),
  ];

  return queryAll<ArtifactRow>(sql, bindParams);
}
