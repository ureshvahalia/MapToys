const API_BASE = '/api';

export interface ArtifactProperties {
  id: number;
  artifact_type: string;
  timestamp: string;
  title: string;
  description: string;
  latitude: number;
  longitude: number;
  camera_make: string | null;
  camera_model: string | null;
  thumbnail_path: string | null;
}

export interface ArtifactFeature {
  type: 'Feature';
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: ArtifactProperties;
}

export interface ArtifactsGeoJSON {
  type: 'FeatureCollection';
  features: ArtifactFeature[];
}

export interface ViewportParams {
  minLat: number;
  maxLat: number;
  minLng: number;
  maxLng: number;
  windowStart: string;
  windowEnd: string;
  collectionId?: number;
}

export async function fetchArtifacts(params: ViewportParams, signal?: AbortSignal): Promise<ArtifactsGeoJSON> {
  const query = new URLSearchParams({
    minLat:      params.minLat.toString(),
    maxLat:      params.maxLat.toString(),
    minLng:      params.minLng.toString(),
    maxLng:      params.maxLng.toString(),
    windowStart: params.windowStart,
    windowEnd:   params.windowEnd,
    ...(params.collectionId != null && { collectionId: params.collectionId.toString() }),
  });
  const res = await fetch(`${API_BASE}/artifacts?${query}`, { signal });
  if (!res.ok) throw new Error(`Artifacts fetch failed: ${res.status}`);
  return res.json() as Promise<ArtifactsGeoJSON>;
}

export function photoUrl(artifactId: number): string {
  return `${API_BASE}/photos/${artifactId}`;
}

export function thumbnailUrl(artifactId: number): string {
  return `${API_BASE}/photos/${artifactId}/thumbnail`;
}


// ---- Import API -------------------------------------------------------------

export interface StartImportParams {
  type:              'folder' | 'digikam';
  collection:        string;
  sources?:          string[];
  digikamPath?:      string;
  digikamRoot?:      string;
  albumFilter?:      string;
  tagFilter?:        string;
  inferGps?:         boolean;
  includeNoGps?:     boolean;
  dryRun?:           boolean;
  inferGpsWindowMin?: number;
}

export interface ImportJobStats {
  imported: number;
  skipped:  number;
  noGps:    number;
  missing:  number;
  errors:   number;
  total:    number;
}

export interface ImportJob {
  id:          string;
  status:      'running' | 'done' | 'cancelled' | 'error';
  phase:       string;
  progress:    { done: number; total: number };
  log:         string[];
  stats?:      ImportJobStats;
  error?:      string;
  startedAt:   number;
  finishedAt?: number;
}

export interface DigiKamAlbum {
  path:       string;
  photoCount: number;
}

export async function startImport(params: StartImportParams): Promise<{ jobId: string }> {
  const res = await fetch(`${API_BASE}/import/start`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<{ jobId: string }>;
}

export async function fetchImportJob(jobId: string): Promise<ImportJob> {
  const res = await fetch(`${API_BASE}/import/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Job fetch failed: ${res.status}`);
  return res.json() as Promise<ImportJob>;
}

export async function fetchDigikamAlbums(digikamPath: string): Promise<DigiKamAlbum[]> {
  const res = await fetch(`${API_BASE}/import/albums?digikam=${encodeURIComponent(digikamPath)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<DigiKamAlbum[]>;
}

export async function cancelImportJob(jobId: string): Promise<void> {
  const res = await fetch(`${API_BASE}/import/jobs/${jobId}/cancel`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
}

export async function reloadDb(): Promise<void> {
  const res = await fetch(`${API_BASE}/import/reload`, { method: 'POST' });
  if (!res.ok) throw new Error(`DB reload failed: ${res.status}`);
}

export async function resetImportData(): Promise<void> {
  const res = await fetch(`${API_BASE}/import/reset`, { method: 'POST' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
}

// ---- Collections API --------------------------------------------------------

export interface CollectionSource {
  directory: string;
  count:     number;
}

export interface CollectionOverview {
  id:             number;
  name:           string;
  description:    string;
  created_at:     string;
  artifact_count: number;
  sources:        CollectionSource[];
}

export async function fetchCollectionsOverview(): Promise<CollectionOverview[]> {
  const res = await fetch(`${API_BASE}/collections/overview`);
  if (!res.ok) throw new Error(`Collections fetch failed: ${res.status}`);
  return res.json() as Promise<CollectionOverview[]>;
}

// ---- Filesystem browser API -------------------------------------------------

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

export async function listFs(
  dirPath: string,
  mode: 'directory' | 'file',
  ext?: string,
): Promise<FsListResult> {
  const params = new URLSearchParams({ path: dirPath, mode });
  if (ext) params.set('ext', ext);
  const res = await fetch(`${API_BASE}/fs/list?${params}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText })) as { error: string };
    throw new Error(err.error ?? res.statusText);
  }
  return res.json() as Promise<FsListResult>;
}
