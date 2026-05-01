import { useEffect, useState } from 'react';
import { listFs, type FsEntry } from '../../services/api';
import './FileBrowser.css';

interface Props {
  mode:         'directory' | 'file';
  fileExt?:     string;
  initialPath?: string;
  onSelect:     (path: string) => void;
  onClose:      () => void;
}

export function FileBrowser({ mode, fileExt, initialPath, onSelect, onClose }: Props) {
  const [current,   setCurrent]   = useState('');
  const [parent,    setParent]    = useState<string | null>(null);
  const [entries,   setEntries]   = useState<FsEntry[]>([]);
  const [loading,   setLoading]   = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [pathInput, setPathInput] = useState(initialPath ?? '');

  const navigate = async (dir: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await listFs(dir, mode, fileExt);
      setCurrent(result.current);
      setParent(result.parent);
      setEntries(result.entries);
      setPathInput(result.current);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { navigate(initialPath ?? ''); }, []);

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    navigate(pathInput);
  };

  return (
    <div className="fb-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fb-panel">

        <div className="fb-header">
          <span className="fb-title">
            {mode === 'directory' ? 'Select folder' : 'Select file'}
          </span>
          <button className="fb-close" onClick={onClose} title="Close">✕</button>
        </div>

        <form className="fb-pathbar" onSubmit={handlePathSubmit}>
          <input
            className="fb-pathinput"
            value={pathInput}
            onChange={e => setPathInput(e.target.value)}
            spellCheck={false}
            placeholder="Type a path and press Go"
          />
          <button type="submit" className="fb-go">Go</button>
        </form>

        {mode === 'directory' && current && (
          <div className="fb-select-row">
            <span className="fb-current-label">{current}</span>
            <button className="fb-select-btn" onClick={() => onSelect(current)}>
              Select this folder
            </button>
          </div>
        )}

        {error && <div className="fb-error">{error}</div>}

        <div className="fb-list">
          {loading && <div className="fb-status">Loading…</div>}

          {!loading && parent !== null && (
            <button className="fb-entry fb-dir" onClick={() => navigate(parent)}>
              <span className="fb-entry-icon">▸</span>
              <span className="fb-entry-name">..</span>
            </button>
          )}

          {!loading && entries.map(e => (
            <button
              key={e.path}
              className={`fb-entry ${e.isDir ? 'fb-dir' : 'fb-file'}`}
              onClick={() => e.isDir ? navigate(e.path) : onSelect(e.path)}
            >
              <span className="fb-entry-icon">{e.isDir ? '▸' : '·'}</span>
              <span className="fb-entry-name">{e.name}</span>
            </button>
          ))}

          {!loading && !error && entries.length === 0 && (
            <div className="fb-status">No items found.</div>
          )}
        </div>

      </div>
    </div>
  );
}
