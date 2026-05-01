import { useEffect, useRef, useState } from 'react';
import { previewUrl, thumbnailUrl } from '../../services/api';
import type { ArtifactProperties } from '../../services/api';
import './DetailPanel.css';

// Module-level: survives component remounts
const loadedPreviews = new Set<number>();

interface Props {
  feature: ArtifactProperties;
  prevId: number | null;
  nextId: number | null;
  onClose: () => void;
  onNavigate: (id: number) => void;
}

export function DetailPanel({ feature, prevId, nextId, onClose, onNavigate }: Props) {
  // Derived synchronously — no useEffect lag. False the instant feature.id changes.
  const [loadedId, setLoadedId] = useState<number | null>(null);
  const previewReady = loadedId === feature.id;

  // Capture whether this photo was already loaded BEFORE we began loading it.
  // Must run in render (not useEffect) so it reads the set before onLoad fires.
  const prevIdRef = useRef<number | null>(null);
  const wasPreloadedRef = useRef(false);
  if (prevIdRef.current !== feature.id) {
    prevIdRef.current = feature.id;
    wasPreloadedRef.current = loadedPreviews.has(feature.id);
  }
  const wasPreloaded = wasPreloadedRef.current;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  const date = new Date(feature.timestamp);
  const dateStr = date.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const camera = [feature.camera_make, feature.camera_model].filter(v => v && v !== 'null').join(' ') || null;
  const lat = typeof feature.latitude === 'number' ? feature.latitude.toFixed(6) : feature.latitude;
  const lng = typeof feature.longitude === 'number' ? feature.longitude.toFixed(6) : feature.longitude;

  return (
    <div className="detail-panel">
      <button className="detail-close" onClick={onClose} title="Close (Esc)">✕</button>

      <div className="detail-photo-wrap">
        {/* Blurred placeholder — always visible until onLoad fires */}
        {feature.thumbnail_path && (
          <img
            className={`detail-thumb-bg${previewReady ? ' detail-thumb-bg-hide' : ''}`}
            src={thumbnailUrl(feature.id)}
            alt=""
          />
        )}
        {/* Preview: fades in on first view, appears instantly on revisit */}
        <img
          key={feature.id}
          className={`detail-photo${
            previewReady
              ? (wasPreloaded ? ' detail-photo-instant' : ' detail-photo-ready')
              : ''
          }`}
          src={previewUrl(feature.id)}
          alt={feature.title || 'Photo'}
          onLoad={() => {
            loadedPreviews.add(feature.id);
            setLoadedId(feature.id);
          }}
        />
      </div>

      <div className="detail-meta">
        {feature.title && <h2 className="detail-title">{feature.title}</h2>}
        <dl className="detail-dl">
          <dt>Date</dt><dd>{dateStr}</dd>
          <dt>Time</dt><dd>{timeStr}</dd>
          {camera && <><dt>Camera</dt><dd>{camera}</dd></>}
          <dt>GPS</dt><dd>{lat}, {lng}</dd>
        </dl>
        {feature.description && <p className="detail-desc">{feature.description}</p>}
      </div>

      <div className="detail-nav">
        <button
          className="detail-nav-btn"
          disabled={prevId === null}
          onClick={() => prevId !== null && onNavigate(prevId)}
        >
          ← Prev
        </button>
        <button
          className="detail-nav-btn"
          disabled={nextId === null}
          onClick={() => nextId !== null && onNavigate(nextId)}
        >
          Next →
        </button>
      </div>
    </div>
  );
}
