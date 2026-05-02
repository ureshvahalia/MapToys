import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { TimelineTrack } from './components/TimelineTrack/TimelineTrack';
import { DetailPanel } from './components/DetailPanel/DetailPanel';
import { ImportPanel } from './components/ImportPanel/ImportPanel';
import { ImportStatusBar } from './components/ImportStatusBar/ImportStatusBar';
import { CollectionsPanel } from './components/CollectionsPanel/CollectionsPanel';
import { fetchArtifacts, cancelImportJob } from './services/api';
import type { ArtifactFeature, ArtifactProperties, ImportJob } from './services/api';
import type { Projection, TrackEdge } from './types';
import './App.css';

const MAP_STYLE  = 'https://tiles.openfreemap.org/styles/liberty';
const TRACK_SIZE = 80;
const FETCH_DEBOUNCE_MS = 350;

const EMPTY_GEOJSON: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function getPadding(edge: TrackEdge): maplibregl.PaddingOptions {
  return {
    top:    edge === 'top'    ? TRACK_SIZE : 0,
    bottom: edge === 'bottom' ? TRACK_SIZE : 0,
    left:   edge === 'left'   ? TRACK_SIZE : 0,
    right:  edge === 'right'  ? TRACK_SIZE : 0,
  };
}

export default function App() {
  const mapContainer    = useRef<HTMLDivElement>(null);
  const mapRef          = useRef<maplibregl.Map | null>(null);
  const popupRef        = useRef<maplibregl.Popup | null>(null);
  const fetchTimer      = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timeWindow      = useRef({ start: new Date('2024-01-01'), end: new Date('2026-01-01') });
  const visibleFeatures = useRef<ArtifactFeature[]>([]);
  const fetchAbort      = useRef<AbortController | null>(null);

  const [projection,    setProjection]    = useState<Projection>('globe');
  const [trackEdge,     setTrackEdge]     = useState<TrackEdge>(() =>
    (localStorage.getItem('timeline-edge') as TrackEdge | null) ?? 'bottom'
  );
  const [selectedProps, setSelectedProps] = useState<ArtifactProperties | null>(null);

  const [collectionsOpen, setCollectionsOpen] = useState(false);

  // ---- Import panel + background status bar ----------------------------------
  const [importOpen,    setImportOpen]    = useState(false);   // overlay visible
  const [importRunning, setImportRunning] = useState(false);   // keep component mounted
  const [importStatus,  setImportStatus]  = useState<{
    jobId:      string;
    job:        ImportJob | null;
    phase:      'running' | 'done' | 'cancelled' | 'error';
    collection: string;
  } | null>(null);

  // ---- Artifact fetch -------------------------------------------------------
  const doFetch = useCallback(async () => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const source = map.getSource('artifacts') as maplibregl.GeoJSONSource | undefined;
    if (!source) return;

    fetchAbort.current?.abort();
    fetchAbort.current = new AbortController();
    const signal = fetchAbort.current.signal;

    const b = map.getBounds();
    try {
      const data = await fetchArtifacts({
        minLat:      b.getSouth(),
        maxLat:      b.getNorth(),
        minLng:      b.getWest(),
        maxLng:      b.getEast(),
        windowStart: timeWindow.current.start.toISOString(),
        windowEnd:   timeWindow.current.end.toISOString(),
      }, signal);
      if (signal.aborted) return;
      visibleFeatures.current = data.features;
      source.setData(data as GeoJSON.FeatureCollection);
    } catch (err) {
      console.warn('Artifact fetch failed:', err);
    }
  }, []);

  const scheduleFetch = useCallback(() => {
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(doFetch, FETCH_DEBOUNCE_MS);
  }, [doFetch]);

  const handleWindowChange = useCallback((start: Date, end: Date) => {
    timeWindow.current = { start, end };
    scheduleFetch();
  }, [scheduleFetch]);

  const handleJobStarted = useCallback((jobId: string, collection: string) => {
    setImportOpen(false);
    setImportRunning(true);
    setImportStatus({ jobId, job: null, phase: 'running', collection });
  }, []);

  const handleJobUpdate = useCallback((
    job: ImportJob | null,
    phase: 'running' | 'done' | 'cancelled' | 'error',
    collection: string,
  ) => {
    setImportStatus(prev =>
      prev ? { ...prev, job, phase } : { jobId: '', job, phase, collection }
    );
  }, []);

  const handleJobEnded = useCallback(() => {
    setImportRunning(false);
    setImportStatus(null);
  }, []);

  // ---- Map init ------------------------------------------------------------
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const popup = new maplibregl.Popup({
      closeButton: false, closeOnClick: false, maxWidth: '220px',
    });
    popupRef.current = popup;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: MAP_STYLE,
      center: [0, 20],
      zoom: 2,
    });

    map.addControl(new maplibregl.NavigationControl(), 'top-left');

    map.on('load', () => {
      map.setProjection({ type: 'globe' });
      map.setPadding(getPadding(trackEdge));

      // ---- Artifact source (with clustering) --------------------------------
      map.addSource('artifacts', {
        type: 'geojson',
        data: EMPTY_GEOJSON,
        cluster: true,
        clusterMaxZoom: 14,
        clusterRadius: 50,
      });

      // Cluster circles
      map.addLayer({
        id: 'artifact-clusters',
        type: 'circle',
        source: 'artifacts',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': [
            'step', ['get', 'point_count'],
            '#4e9af1',  10,
            '#f0a500',  50,
            '#e05252',
          ],
          'circle-radius': [
            'step', ['get', 'point_count'],
            18, 10, 24, 50, 32,
          ],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.88,
        },
      });

      // Cluster count labels
      map.addLayer({
        id: 'artifact-cluster-count',
        type: 'symbol',
        source: 'artifacts',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': '{point_count_abbreviated}',
          'text-size': 12,
        },
        paint: { 'text-color': '#fff' },
      });

      // Individual dots
      map.addLayer({
        id: 'artifact-dots',
        type: 'circle',
        source: 'artifacts',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-radius': 6,
          'circle-color': '#4e9af1',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#fff',
          'circle-opacity': 0.92,
        },
      });

      // ---- Interactions -----------------------------------------------------

      // Hover dot → popup with thumbnail + label
      map.on('mouseenter', 'artifact-dots', e => {
        if (!e.features?.length) return;
        map.getCanvas().style.cursor = 'pointer';
        const f = e.features[0];
        const props = f.properties as Record<string, unknown>;
        const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
        const ts = props.timestamp
          ? new Date(props.timestamp as string).toLocaleDateString()
          : '';
        const thumbUrl = props.thumbnail_path as string | null;
        popup
          .setLngLat(coords)
          .setHTML(
            `${thumbUrl ? `<img class="artifact-thumb" src="${thumbUrl}" />` : ''}` +
            `<div class="artifact-label">${props.title ?? ''}</div>` +
            `<div class="artifact-date">${ts}</div>`
          )
          .addTo(map);
      });

      map.on('mouseleave', 'artifact-dots', () => {
        map.getCanvas().style.cursor = '';
        popup.remove();
      });

      // Click dot → open detail panel
      map.on('click', 'artifact-dots', e => {
        if (!e.features?.length) return;
        const props = e.features[0].properties as ArtifactProperties;
        setSelectedProps(props);
      });

      // Hover cluster → cursor pointer
      map.on('mouseenter', 'artifact-clusters', () => {
        map.getCanvas().style.cursor = 'pointer';
      });
      map.on('mouseleave', 'artifact-clusters', () => {
        map.getCanvas().style.cursor = '';
      });

      // Click cluster → zoom to expand
      map.on('click', 'artifact-clusters', e => {
        if (!e.features?.length) return;
        const f = e.features[0];
        const clusterId = (f.properties as Record<string, number>).cluster_id;
        const source = map.getSource('artifacts') as maplibregl.GeoJSONSource;
        source.getClusterExpansionZoom(clusterId).then(zoom => {
          map.easeTo({
            center: (f.geometry as GeoJSON.Point).coordinates as [number, number],
            zoom,
          });
        });
      });

      // Fetch artifacts after style load
      map.on('moveend', scheduleFetch);
      scheduleFetch();
    });

    mapRef.current = map;
    return () => {
      if (fetchTimer.current) clearTimeout(fetchTimer.current);
      fetchAbort.current?.abort();
      popup.remove();
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- Projection toggle ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.setProjection({ type: projection });
  }, [projection]);

  // ---- Track edge change ---------------------------------------------------
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    map.easeTo({ padding: getPadding(trackEdge), duration: 300 });
  }, [trackEdge]);

  const handleEdgeChange = (edge: TrackEdge) => {
    setTrackEdge(edge);
    localStorage.setItem('timeline-edge', edge);
  };

  // ---- Detail panel prev/next --------------------------------------------
  // Filter against current viewport bounds at render time so that stale or
  // wide-bounds fetch data never leaks into the navigation chain.
  const bounds = mapRef.current?.getBounds() ?? null;
  const navFeatures = bounds
    ? visibleFeatures.current.filter(f =>
        bounds.contains([f.properties.longitude, f.properties.latitude])
      )
    : visibleFeatures.current;

  const detailIdx = selectedProps !== null
    ? navFeatures.findIndex(f => f.properties.id === selectedProps.id)
    : -1;
  const prevId = detailIdx > 0
    ? navFeatures[detailIdx - 1].properties.id
    : null;
  const nextId = detailIdx >= 0 && detailIdx < navFeatures.length - 1
    ? navFeatures[detailIdx + 1].properties.id
    : null;

  const handleNavigate = (id: number) => {
    const f = visibleFeatures.current.find(f => f.properties.id === id);
    if (f) setSelectedProps(f.properties);
  };

  // ---- Render --------------------------------------------------------------
  return (
    <div className="app-root">
      <div ref={mapContainer} className="map-container" />
      <div className={`map-toolbar${trackEdge === 'right' ? ' map-toolbar-shift-right' : ''}`}>
        <button
          className="projection-toggle"
          onClick={() => setProjection(p => p === 'globe' ? 'mercator' : 'globe')}
          title="Toggle map projection"
        >
          {projection === 'globe' ? 'Flat map' : 'Globe'}
        </button>
        <button
          className="import-toggle"
          onClick={() => setCollectionsOpen(v => !v)}
          title="View imported collections"
        >
          Collections
        </button>
        <button
          className="import-toggle"
          onClick={() => {
            setImportOpen(v => !v);
            if (!importRunning) setImportRunning(false);
          }}
          title="Import photos"
        >
          Import
        </button>
      </div>
      <TimelineTrack
        edge={trackEdge}
        onEdgeChange={handleEdgeChange}
        onWindowChange={handleWindowChange}
      />
      {selectedProps !== null && (
        <DetailPanel
          feature={selectedProps}
          prevId={prevId}
          nextId={nextId}
          onClose={() => setSelectedProps(null)}
          onNavigate={handleNavigate}
        />
      )}
      {collectionsOpen && (
        <CollectionsPanel onClose={() => setCollectionsOpen(false)} />
      )}
      {(importOpen || importRunning) && (
        <ImportPanel
          visible={importOpen}
          onClose={() => setImportOpen(false)}
          onMapRefresh={doFetch}
          onJobStarted={handleJobStarted}
          onJobUpdate={handleJobUpdate}
          onJobEnded={handleJobEnded}
        />
      )}
      {importStatus && (
        <ImportStatusBar
          collection={importStatus.collection}
          job={importStatus.job}
          phase={importStatus.phase}
          onDetails={() => { setImportRunning(true); setImportOpen(true); }}
          onCancel={async () => {
            if (importStatus.jobId) {
              try { await cancelImportJob(importStatus.jobId); } catch { /* ignore */ }
            }
          }}
          onDismiss={() => { setImportRunning(false); setImportStatus(null); }}
        />
      )}
    </div>
  );
}
