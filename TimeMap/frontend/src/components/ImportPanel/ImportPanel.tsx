import { useEffect, useRef, useState } from 'react';
import {
  startImport,
  fetchImportJob,
  cancelImportJob,
  fetchDigikamAlbums,
  reloadDb,
  resetImportData,
  type ImportJob,
  type DigiKamAlbum,
  type StartImportParams,
} from '../../services/api';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import './ImportPanel.css';

type ImportType  = 'folder' | 'digikam';
type PanelPhase  = 'form' | 'running' | 'done' | 'cancelled' | 'error';

interface Props {
  onClose:      () => void;
  onMapRefresh: () => void;
}

export function ImportPanel({ onClose, onMapRefresh }: Props) {
  // ---- Form state ------------------------------------------------------------
  const [importType,   setImportType]   = useState<ImportType>('folder');
  const [source,       setSource]       = useState('');
  const [digikamPath,  setDigikamPath]  = useState('');
  const [digikamRoot,  setDigikamRoot]  = useState('');
  const [albumFilter,  setAlbumFilter]  = useState('');
  const [tagFilter,    setTagFilter]    = useState('');
  const [collection,   setCollection]   = useState('');
  const [inferGps,     setInferGps]     = useState(false);
  const [includeNoGps, setIncludeNoGps] = useState(false);

  // ---- File browser ----------------------------------------------------------
  type BrowserTarget = 'source' | 'digikamPath' | 'digikamRoot';
  const [browserFor, setBrowserFor] = useState<BrowserTarget | null>(null);

  const handleBrowserSelect = (selectedPath: string) => {
    if (browserFor === 'source')      setSource(selectedPath);
    if (browserFor === 'digikamPath') { setDigikamPath(selectedPath); setShowAlbums(false); }
    if (browserFor === 'digikamRoot') setDigikamRoot(selectedPath);
    setBrowserFor(null);
  };

  // Strip filename from a path to get its containing directory
  const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || '';

  // ---- Album browser ---------------------------------------------------------
  const [albums,        setAlbums]        = useState<DigiKamAlbum[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError,   setAlbumsError]   = useState<string | null>(null);
  const [showAlbums,    setShowAlbums]    = useState(false);

  // ---- Job state -------------------------------------------------------------
  const [phase,    setPhase]    = useState<PanelPhase>('form');
  const [jobId,    setJobId]    = useState<string | null>(null);
  const [job,      setJob]      = useState<ImportJob | null>(null);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [reloading,   setReloading]   = useState(false);
  const [resetting,   setResetting]   = useState(false);
  const [resetError,  setResetError]  = useState<string | null>(null);

  const logRef    = useRef<HTMLDivElement>(null);
  const pollRef   = useRef<ReturnType<typeof setInterval> | null>(null);

  // ---- Polling ---------------------------------------------------------------
  useEffect(() => {
    if (!jobId || phase !== 'running') return;
    pollRef.current = setInterval(async () => {
      try {
        const j = await fetchImportJob(jobId);
        setJob(j);
        if (j.status === 'done')      setPhase('done');
        if (j.status === 'cancelled') setPhase('cancelled');
        if (j.status === 'error')     setPhase('error');
      } catch { /* keep polling */ }
    }, 500);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [jobId, phase]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log.length]);

  // ---- Album browser ---------------------------------------------------------
  const handleBrowseAlbums = async () => {
    if (!digikamPath) return;
    setAlbumsLoading(true);
    setAlbumsError(null);
    setShowAlbums(false);
    try {
      const list = await fetchDigikamAlbums(digikamPath);
      setAlbums(list);
      setShowAlbums(true);
    } catch (err) {
      setAlbumsError(String(err));
    } finally {
      setAlbumsLoading(false);
    }
  };

  // ---- Start import ----------------------------------------------------------
  const handleStart = async (dryRun: boolean) => {
    setStartErr(null);
    const params: StartImportParams = {
      type: importType,
      collection,
      dryRun,
      inferGps,
      includeNoGps,
      ...(importType === 'folder'
        ? { source }
        : {
            digikamPath,
            digikamRoot,
            albumFilter: albumFilter || undefined,
            tagFilter:   tagFilter   || undefined,
          }),
    };

    try {
      const { jobId: id } = await startImport(params);
      setJobId(id);
      setJob(null);
      setPhase('running');
    } catch (err) {
      setStartErr(String(err));
    }
  };

  // ---- Cancel running job ----------------------------------------------------
  const handleCancel = async () => {
    if (!jobId) return;
    try { await cancelImportJob(jobId); } catch { /* job may have just finished */ }
  };

  // ---- Reload DB + refresh map -----------------------------------------------
  const handleReload = async () => {
    setReloading(true);
    try {
      await reloadDb();
      onMapRefresh();
    } finally {
      setReloading(false);
    }
  };

  // ---- Reset all data --------------------------------------------------------
  const handleReset = async () => {
    if (!window.confirm('Delete all imported photos, collections, and thumbnails? This cannot be undone.')) return;
    setResetting(true);
    setResetError(null);
    try {
      await resetImportData();
      onMapRefresh();
    } catch (err) {
      setResetError(String(err));
    } finally {
      setResetting(false);
    }
  };

  // ---- Progress bar ----------------------------------------------------------
  const progressPct = job && job.progress.total > 0
    ? Math.round((job.progress.done / job.progress.total) * 100)
    : 0;

  // ---- Validation ------------------------------------------------------------
  const canStart = collection.trim() !== '' && (
    importType === 'folder'
      ? source.trim() !== ''
      : digikamPath.trim() !== '' && digikamRoot.trim() !== ''
  );

  // ---- Render ----------------------------------------------------------------
  return (
    <div className="import-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="import-panel">

        {/* Header */}
        <div className="import-header">
          <span className="import-title">Import Photos</span>
          <button className="import-close" onClick={onClose} title="Close">✕</button>
        </div>

        {phase === 'form' && (
          <>
            {/* Type tabs */}
            <div className="import-tabs">
              <button
                className={`import-tab${importType === 'folder' ? ' active' : ''}`}
                onClick={() => setImportType('folder')}
              >
                Folder scan
              </button>
              <button
                className={`import-tab${importType === 'digikam' ? ' active' : ''}`}
                onClick={() => setImportType('digikam')}
              >
                DigiKam DB
              </button>
            </div>

            <div className="import-form">

              {importType === 'folder' && (
                <label className="import-field">
                  <span>Source directory</span>
                  <div className="import-input-row">
                    <input
                      type="text"
                      value={source}
                      onChange={e => setSource(e.target.value)}
                      placeholder="/path/to/photos"
                      spellCheck={false}
                    />
                    <button
                      type="button"
                      className="import-field-browse-btn"
                      onClick={() => setBrowserFor('source')}
                    >
                      Browse…
                    </button>
                  </div>
                </label>
              )}

              {importType === 'digikam' && (
                <>
                  <label className="import-field">
                    <span>DigiKam database</span>
                    <div className="import-input-row">
                      <input
                        type="text"
                        value={digikamPath}
                        onChange={e => { setDigikamPath(e.target.value); setShowAlbums(false); }}
                        placeholder="/path/to/digikam4.db"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="import-field-browse-btn"
                        onClick={() => setBrowserFor('digikamPath')}
                      >
                        Browse…
                      </button>
                    </div>
                  </label>

                  <label className="import-field">
                    <span>Photos root directory</span>
                    <div className="import-input-row">
                      <input
                        type="text"
                        value={digikamRoot}
                        onChange={e => setDigikamRoot(e.target.value)}
                        placeholder="/path/to/photos"
                        spellCheck={false}
                      />
                      <button
                        type="button"
                        className="import-field-browse-btn"
                        onClick={() => setBrowserFor('digikamRoot')}
                      >
                        Browse…
                      </button>
                    </div>
                  </label>

                  <label className="import-field">
                    <span>
                      Album filter
                      <button
                        className="import-browse-btn"
                        disabled={!digikamPath || albumsLoading}
                        onClick={handleBrowseAlbums}
                        title="List albums from this DigiKam DB"
                      >
                        {albumsLoading ? 'Loading…' : 'Browse'}
                      </button>
                    </span>
                    <input
                      type="text"
                      value={albumFilter}
                      onChange={e => setAlbumFilter(e.target.value)}
                      placeholder="/2024/Italy  (optional)"
                      spellCheck={false}
                    />
                  </label>

                  {albumsError && <div className="import-error-inline">{albumsError}</div>}

                  {showAlbums && (
                    <div className="import-album-list">
                      {albums.length === 0
                        ? <div className="import-album-empty">No albums found.</div>
                        : albums.map(a => (
                            <button
                              key={a.path}
                              className="import-album-item"
                              onClick={() => { setAlbumFilter(a.path); setShowAlbums(false); }}
                            >
                              <span className="import-album-path">{a.path}</span>
                              <span className="import-album-count">{a.photoCount}</span>
                            </button>
                          ))
                      }
                    </div>
                  )}

                  <label className="import-field">
                    <span>Tag filter <em>(optional)</em></span>
                    <input
                      type="text"
                      value={tagFilter}
                      onChange={e => setTagFilter(e.target.value)}
                      placeholder="Keepers"
                      spellCheck={false}
                    />
                  </label>
                </>
              )}

              <label className="import-field">
                <span>Collection name</span>
                <input
                  type="text"
                  value={collection}
                  onChange={e => setCollection(e.target.value)}
                  placeholder="My Travels 2024"
                />
              </label>

              <div className="import-options">
                <label className="import-checkbox">
                  <input type="checkbox" checked={inferGps} onChange={e => setInferGps(e.target.checked)} />
                  Infer GPS from nearby geotagged photos (±30 min)
                </label>
                <label className="import-checkbox">
                  <input type="checkbox" checked={includeNoGps} onChange={e => setIncludeNoGps(e.target.checked)} />
                  Include photos without GPS coordinates
                </label>
              </div>

              {startErr && <div className="import-error-inline">{startErr}</div>}

              <div className="import-actions">
                <button
                  className="import-btn-secondary"
                  disabled={!canStart}
                  onClick={() => handleStart(true)}
                >
                  Dry run
                </button>
                <button
                  className="import-btn-primary"
                  disabled={!canStart}
                  onClick={() => handleStart(false)}
                >
                  Import
                </button>
              </div>

              <div className="import-danger-zone">
                {resetError && (
                  <div className="import-error-inline" style={{ flex: 1, marginRight: 8 }}>
                    {resetError}
                  </div>
                )}
                <button
                  className="import-btn-danger"
                  disabled={resetting}
                  onClick={handleReset}
                >
                  {resetting ? 'Resetting…' : 'Reset database…'}
                </button>
              </div>
            </div>
          </>
        )}

        {(phase === 'running' || phase === 'done' || phase === 'cancelled' || phase === 'error') && (
          <div className="import-progress-section">

            {/* Phase + progress bar */}
            <div className="import-phase-row">
              <span className="import-phase-label">
                {phase === 'done'      ? 'Done'
               : phase === 'cancelled' ? 'Cancelled'
               : phase === 'error'     ? 'Error'
               : job?.phase ?? 'Starting…'}
              </span>
              {job && job.progress.total > 0 && (
                <span className="import-phase-count">
                  {job.progress.done}/{job.progress.total}
                </span>
              )}
            </div>

            <div className="import-progressbar-track">
              <div
                className={`import-progressbar-fill${phase === 'error' ? ' error' : ''}`}
                style={{ width: phase === 'done' ? '100%' : `${progressPct}%` }}
              />
            </div>

            {/* Log */}
            <div className="import-log" ref={logRef}>
              {(job?.log ?? []).map((line, i) => (
                <div key={i} className="import-log-line">{line}</div>
              ))}
              {phase === 'running' && !job?.log.length && (
                <div className="import-log-line import-log-muted">Starting…</div>
              )}
            </div>

            {/* Stats summary */}
            {phase === 'done' && job?.stats && (
              <div className="import-stats">
                <div className="import-stat"><span>Imported</span><strong>{job.stats.imported}</strong></div>
                {job.stats.skipped  > 0 && <div className="import-stat"><span>Skipped</span><strong>{job.stats.skipped}</strong></div>}
                {job.stats.noGps    > 0 && <div className="import-stat"><span>No GPS</span><strong>{job.stats.noGps}</strong></div>}
                {job.stats.missing  > 0 && <div className="import-stat"><span>Missing</span><strong>{job.stats.missing}</strong></div>}
                {job.stats.errors   > 0 && <div className="import-stat import-stat-error"><span>Errors</span><strong>{job.stats.errors}</strong></div>}
              </div>
            )}

            {phase === 'error' && (
              <div className="import-error-inline">{job?.error ?? 'Unknown error'}</div>
            )}

            <div className="import-actions">
              {phase === 'running' && (
                <button className="import-btn-secondary" onClick={handleCancel}>
                  Cancel
                </button>
              )}
              {(phase === 'done' || phase === 'cancelled' || phase === 'error') && (
                <button className="import-btn-secondary" onClick={() => setPhase('form')}>
                  ← Back
                </button>
              )}
              {(phase === 'done' || phase === 'cancelled') && job?.stats && job.stats.imported > 0 && (
                <button
                  className="import-btn-primary"
                  disabled={reloading}
                  onClick={handleReload}
                >
                  {reloading ? 'Reloading…' : 'Reload map'}
                </button>
              )}
            </div>
          </div>
        )}

      </div>

      {browserFor !== null && (
        <FileBrowser
          mode={browserFor === 'digikamPath' ? 'file' : 'directory'}
          fileExt={browserFor === 'digikamPath' ? '.db' : undefined}
          initialPath={
            browserFor === 'source'      ? source :
            browserFor === 'digikamPath' ? (digikamPath ? dirOf(digikamPath) : '') :
            digikamRoot
          }
          onSelect={handleBrowserSelect}
          onClose={() => setBrowserFor(null)}
        />
      )}
    </div>
  );
}
