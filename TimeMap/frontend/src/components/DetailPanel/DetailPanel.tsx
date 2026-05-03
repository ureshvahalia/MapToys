import { useEffect } from 'react';
import { thumbnailUrl, viewerUrl } from '../../services/api';
import type { ArtifactProperties } from '../../services/api';
import './DetailPanel.css';

interface Props {
  feature: ArtifactProperties;
  prevId: number | null;
  nextId: number | null;
  onClose: () => void;
  onNavigate: (id: number) => void;
}

export function DetailPanel({ feature, prevId, nextId, onClose, onNavigate }: Props) {
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
        {feature.thumbnail_path
          ? <img className="detail-thumb" src={thumbnailUrl(feature.id)} alt={feature.title || 'Photo'} />
          : <div className="detail-thumb-missing" />
        }
        <a
          className="detail-view-full"
          href={viewerUrl(feature.id)}
          target="_blank"
          rel="noreferrer"
        >
          View full
        </a>
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
