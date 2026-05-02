import { useEffect, useState } from 'react';
import { fetchCollectionsOverview, type CollectionOverview } from '../../services/api';
import './CollectionsPanel.css';

interface Props {
  onClose: () => void;
}

export function CollectionsPanel({ onClose }: Props) {
  const [collections, setCollections] = useState<CollectionOverview[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [expanded,    setExpanded]    = useState<Set<number>>(new Set());

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchCollectionsOverview();
      setCollections(data);
      // Auto-expand if only one collection
      if (data.length === 1) setExpanded(new Set([data[0].id]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, []);

  const toggleExpand = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const formatDir = (dir: string) => {
    // Shorten very long paths by showing only the last 2–3 segments
    const sep = dir.includes('\\') ? '\\' : '/';
    const parts = dir.split(sep).filter(Boolean);
    if (parts.length <= 3) return dir;
    return sep + ['…', ...parts.slice(-2)].join(sep);
  };

  return (
    <div className="collections-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="collections-panel">
        <div className="collections-header">
          <span className="collections-title">Collections</span>
          <div className="collections-header-actions">
            <button
              className="collections-refresh"
              onClick={load}
              disabled={loading}
              title="Refresh"
            >
              {loading ? '…' : '↻'}
            </button>
            <button className="collections-close" onClick={onClose} title="Close">✕</button>
          </div>
        </div>

        <div className="collections-body">
          {loading && collections.length === 0 && (
            <div className="collections-empty">Loading…</div>
          )}
          {error && (
            <div className="collections-error">{error}</div>
          )}
          {!loading && !error && collections.length === 0 && (
            <div className="collections-empty">No collections imported yet.</div>
          )}
          {collections.map(col => {
            const isOpen = expanded.has(col.id);
            return (
              <div key={col.id} className="collection-item">
                <button
                  className="collection-row"
                  onClick={() => toggleExpand(col.id)}
                >
                  <span className="collection-chevron">{isOpen ? '▾' : '▸'}</span>
                  <span className="collection-name">{col.name}</span>
                  <span className="collection-count">{col.artifact_count.toLocaleString()} photos</span>
                </button>
                {isOpen && (
                  <div className="collection-sources">
                    {col.sources.length === 0 && (
                      <div className="source-empty">No source directories found.</div>
                    )}
                    {col.sources.map(src => (
                      <div key={src.directory} className="source-row" title={src.directory}>
                        <span className="source-dir">{formatDir(src.directory)}</span>
                        <span className="source-count">{src.count.toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
