import { useEffect, useState } from 'react';
import { listFs, type FsEntry } from '../../services/api';
import './FileBrowser.css';

interface Props {
  mode:          'directory' | 'file';
  fileExt?:      string;
  initialPath?:  string;
  multiSelect?:  boolean;
  onSelect:      (paths: string[]) => void;
  onClose:       () => void;
}

interface Crumb { label: string; navPath: string; }

function parseCrumbs(p: string): Crumb[] {
  if (!p) return [];
  const winMatch = p.match(/^([A-Za-z]:)[\\\/]/);
  if (winMatch) {
    const drive = winMatch[1];
    const root  = drive + '\\';
    const rest  = p.slice(root.length);
    const parts = rest ? rest.split(/[\\\/]/).filter(Boolean) : [];
    const crumbs: Crumb[] = [{ label: drive, navPath: root }];
    let acc = root;
    for (const part of parts) {
      acc = acc + part + '\\';
      crumbs.push({ label: part, navPath: acc.slice(0, -1) });
    }
    return crumbs;
  }
  const parts  = p.split('/').filter(Boolean);
  const crumbs: Crumb[] = [{ label: '/', navPath: '/' }];
  let acc = '';
  for (const part of parts) {
    acc += '/' + part;
    crumbs.push({ label: part, navPath: acc });
  }
  return crumbs;
}

export function FileBrowser({ mode, fileExt, initialPath, multiSelect, onSelect, onClose }: Props) {
  const [current,   setCurrent]   = useState('');
  const [parent,    setParent]    = useState<string | null>(null);
  const [entries,   setEntries]   = useState<FsEntry[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? '');
  const [selected,  setSelected]  = useState<Set<string>>(new Set());

  const navigate = async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFs(dir, mode, fileExt);
      setCurrent(result.current);
      setParent(result.parent);
      const sorted = [...result.entries].sort((a, b) => {
        if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
        return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
      });
      setEntries(sorted);
      setPathInput(result.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (path: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path); else next.add(path);
      return next;
    });
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { navigate(initialPath ?? ''); }, []);

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(pathInput);
  };

  const crumbs = parseCrumbs(current);
  const n      = selected.size;

  return (
    <div className="fb-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fb-panel">

        {/* Title bar */}
        <div className="fb-header">
          <span className="fb-title">
            {mode === 'file'    ? 'Select File'
             : multiSelect      ? 'Select Folders'
             :                    'Select Folder'}
          </span>
          <button className="fb-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Breadcrumb toolbar */}
        <div className="fb-breadcrumb-bar">
          <button
            className="fb-up-btn"
            disabled={parent === null || loading}
            onClick={() => parent !== null && navigate(parent)}
            title="Up one level"
          >
            ↑
          </button>
          <div className="fb-crumbs">
            {crumbs.map((c, i) => (
              <span key={i} className="fb-crumb">
                {i > 0 && <span className="fb-crumb-sep">›</span>}
                {i < crumbs.length - 1 ? (
                  <button className="fb-crumb-btn" onClick={() => navigate(c.navPath)}>
                    {c.label}
                  </button>
                ) : (
                  <span className="fb-crumb-cur">{c.label}</span>
                )}
              </span>
            ))}
          </div>
        </div>

        {/* Address bar */}
        <form className="fb-pathbar" onSubmit={handlePathSubmit}>
          <input
            className="fb-pathinput"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            spellCheck={false}
            placeholder="Type a path and press Enter"
          />
          <button type="submit" className="fb-go">Go</button>
        </form>

        {/* Single-select confirm row — hidden in multiSelect mode */}
        {mode === 'directory' && !multiSelect && current && (
          <div className="fb-select-row">
            <span className="fb-current-label">{current}</span>
            <button className="fb-select-btn" onClick={() => onSelect([current])}>
              Select Folder
            </button>
          </div>
        )}

        {error && <div className="fb-error">{error}</div>}

        {/* File / folder list */}
        <div className="fb-list">
          {loading && <div className="fb-status">Loading…</div>}

          {!loading && entries.map(e => (
            <button
              key={e.path}
              className={`fb-entry ${e.isDir ? 'fb-dir' : 'fb-file'}${multiSelect && selected.has(e.path) ? ' fb-checked' : ''}`}
              onClick={() => e.isDir ? navigate(e.path) : onSelect([e.path])}
            >
              {multiSelect && e.isDir && (
                <input
                  type="checkbox"
                  className="fb-checkbox"
                  checked={selected.has(e.path)}
                  onChange={() => toggleSelect(e.path)}
                  onClick={ev => ev.stopPropagation()}
                />
              )}
              <span className="fb-entry-icon">{e.isDir ? '▸' : ''}</span>
              <span className="fb-entry-name">{e.name}</span>
            </button>
          ))}

          {!loading && !error && entries.length === 0 && (
            <div className="fb-status">No items found.</div>
          )}
        </div>

        {/* Multi-select confirm bar */}
        {multiSelect && (
          <div className="fb-confirm-bar">
            <span className="fb-confirm-info">
              {n > 0 ? `${n} folder${n !== 1 ? 's' : ''} selected` : 'Check folders to add'}
            </span>
            <button
              className="fb-confirm-btn"
              disabled={n === 0}
              onClick={() => onSelect(Array.from(selected))}
            >
              {n > 0 ? `Add ${n} Folder${n !== 1 ? 's' : ''}` : 'Add Folders'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
