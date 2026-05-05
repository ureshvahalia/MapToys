import { useEffect, useRef, useState } from 'react';
import {
  startImport,
  fetchImportJob,
  cancelImportJob,
  fetchDigikamAlbums,
  fetchPhotosAlbums,
  fetchSystemInfo,
  reloadDb,
  resetImportData,
  type ImportJob,
  type DigiKamAlbum,
  type PhotosAlbum,
  type StartImportParams,
} from '../../services/api';
import { FileBrowser } from '../FileBrowser/FileBrowser';
import './ImportPanel.css';

type ImportType  = 'photos' | 'folder' | 'digikam';
type PanelPhase  = 'form' | 'running' | 'done' | 'cancelled' | 'error';

interface Props {
  visible:       boolean;
  onClose:       () => void;
  onMapRefresh:  () => void;
  onJobStarted:  (jobId: string, collection: string) => void;
  onJobUpdate?:  (job: ImportJob | null, phase: Exclude<PanelPhase, 'form'>, collection: string) => void;
  onJobEnded?:   () => void;
}

export function ImportPanel({
  visible, onClose, onMapRefresh, onJobStarted, onJobUpdate, onJobEnded,
}: Props) {
  // ---- System info (Photos availability) ------------------------------------
  const [photosAvailable, setPhotosAvailable] = useState(false);

  // ---- Form state ------------------------------------------------------------
  const [importType,      setImportType]      = useState<ImportType>('folder');
  const [sources,         setSources]         = useState<string[]>([]);
  const [digikamPath,     setDigikamPath]     = useState('');
  const [digikamRoot,     setDigikamRoot]     = useState('');
  const [albumFilter,     setAlbumFilter]     = useState('');
  const [tagFilter,       setTagFilter]       = useState('');
  const [collection,      setCollection]      = useState('');
  const [inferGps,        setInferGps]        = useState(false);
  const [includeNoGps,    setIncludeNoGps]    = useState(false);

  // ---- Photos album state ----------------------------------------------------
  const [photosAlbums,      setPhotosAlbums]      = useState<PhotosAlbum[]>([]);
  const [photosAlbumsLoading, setPhotosAlbumsLoading] = useState(false);
  const [photosAlbumsError,   setPhotosAlbumsError]   = useState<string | null>(null);
  const [selectedAlbumId,   setSelectedAlbumId]   = useState<string>('__all__');

  // ---- File browser ----------------------------------------------------------
  type BrowserTarget = 'sourceAdd' | 'digikamPath' | 'digikamRoot';
  const [browserFor, setBrowserFor] = useState<BrowserTarget | null>(null);

  const handleBrowserSelect = (paths: string[]) => {
    if (browserFor === 'sourceAdd')   setSources(prev => [...prev, ...paths]);
    if (browserFor === 'digikamPath') { setDigikamPath(paths[0] ?? ''); setShowAlbums(false); }
    if (browserFor === 'digikamRoot') setDigikamRoot(paths[0] ?? '');
    setBrowserFor(null);
  };

  const dirOf = (p: string) => p.replace(/[\\/][^\\/]*$/, '') || '';

  // ---- DigiKam album browser -------------------------------------------------
  const [albums,        setAlbums]        = useState<DigiKamAlbum[]>([]);
  const [albumsLoading, setAlbumsLoading] = useState(false);
  const [albumsError,   setAlbumsError]   = useState<string | null>(null);
  const [showAlbums,    setShowAlbums]    = useState(false);

  // ---- Job state -------------------------------------------------------------
  const [phase,    setPhase]    = useState<PanelPhase>('form');
  const [jobId,    setJobId]    = useState<string | null>(null);
  const [job,      setJob]      = useState<ImportJob | null>(null);
  const [startErr, setStartErr] = useState<string | null>(null);
  const [reloading,  setReloading]  = useState(false);
  const [resetting,  setResetting]  = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const logRef  = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Stable refs for callbacks
  const onJobUpdateRef = useRef(onJobUpdate);
  useEffect(() => { onJobUpdateRef.current = onJobUpdate; }, [onJobUpdate]);
  const collectionRef = useRef(collection);
  useEffect(() => { collectionRef.current = collection; }, [collection]);

  // ---- Load system info when panel first opens -------------------------------
  const systemLoadedRef = useRef(false);
  useEffect(() => {
    if (!visible || systemLoadedRef.current) return;
    systemLoadedRef.current = true;
    fetchSystemInfo()
      .then(info => {
        setPhotosAvailable(info.photosAvailable);
        if (info.photosAvailable) setImportType('photos');
      })
      .catch(() => { /* non-Mac or helper not present */ });
  }, [visible]);

  // ---- Load Photos albums when Photos tab becomes active --------------------
  useEffect(() => {
    if (importType !== 'photos' || !photosAvailable || photosAlbums.length > 0) return;
    setPhotosAlbumsLoading(true);
    setPhotosAlbumsError(null);
    fetchPhotosAlbums()
      .then(list => {
        setPhotosAlbums(list);
        if (list.length > 0) {
          setSelectedAlbumId(list[0].id);
          setCollection(list[0].name);
        }
      })
      .catch(err => setPhotosAlbumsError(String(err)))
      .finally(() => setPhotosAlbumsLoading(false));
  }, [importType, photosAvailable, photosAlbums.length]);

  // ---- Polling ---------------------------------------------------------------
  useEffect(() => {
    if (!jobId || phase !== 'running') return;
    pollRef.current = setInterval(async () => {
      try {
        const j = await fetchImportJob(jobId);
        const newPhase: Exclude<PanelPhase, 'form'> =
          j.status === 'done'      ? 'done'      :
          j.status === 'cancelled' ? 'cancelled' :
          j.status === 'error'     ? 'error'     : 'running';
        setJob(j);
        setPhase(newPhase);
        onJobUpdateRef.current?.(j, newPhase, collectionRef.current);
      } catch { /* keep polling */ }
    }, 500);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [jobId, phase]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [job?.log.length]);

  // ---- DigiKam album browser -------------------------------------------------
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
    let params: StartImportParams;

    if (importType === 'photos') {
      params = {
        type: 'photos',
        collection,
        dryRun,
        includeNoGps,
        albumId: selectedAlbumId !== '__all__' ? selectedAlbumId : undefined,
      };
    } else if (importType === 'folder') {
      params = { type: 'folder', collection, dryRun, inferGps, includeNoGps, sources };
    } else {
      params = {
        type: 'digikam',
        collection,
        dryRun,
        inferGps,
        includeNoGps,
        digikamPath,
        digikamRoot,
        albumFilter: albumFilter || undefined,
        tagFilter:   tagFilter   || undefined,
      };
    }

    try {
      const { jobId: id } = await startImport(params);
      setJobId(id);
      setJob(null);
      setPhase('running');
      onJobUpdate?.(null, 'running', collection);
      onJobStarted(id, collection);
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

  // ---- Back: return to form after job complete --------------------------------
  const handleBack = () => {
    setPhase('form');
    onJobEnded?.();
  };

  // ---- Progress bar ----------------------------------------------------------
  const progressPct = job && job.progress.total > 0
    ? Math.round((job.progress.done / job.progress.total) * 100)
    : 0;

  // ---- Validation ------------------------------------------------------------
  const canStart = collection.trim() !== '' && (
    importType === 'photos'
      ? true
      : importType === 'folder'
      ? sources.length > 0 && sources.every(s => s.trim() !== '')
      : digikamPath.trim() !== '' && digikamRoot.trim() !== ''
  );

  if (!visible) return null;

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
              {photosAvailable && (
                <button
                  className={`import-tab${importType === 'photos' ? ' active' : ''}`}
                  onClick={() => setImportType('photos')}
                >
                  Photos
                </button>
              )}
              <button
                className={`import-tab${importType === 'folder' ? ' active' : ''}`}
                onClick={() => setImportType('folder')}
              >
                Folder
              </button>
              <button
                className={`import-tab${importType === 'digikam' ? ' active' : ''}`}
                onClick={() => setImportType('digikam')}
              >
                DigiKam DB
              </button>
            </div>

            <div className="import-form">

              {/* ---- Photos tab ---- */}
              {importType === 'photos' && (
                <>
                  <div className="import-field">
                    <span>Album</span>
                    {photosAlbumsLoading && (
                      <div className="import-log-muted" style={{ fontSize: 12, padding: '6px 0' }}>
                        Loading albums…
                      </div>
                    )}
                    {photosAlbumsError && (
                      <div className="import-error-inline">{photosAlbumsError}</div>
                    )}
                    {photosAlbums.length > 0 && (
                      <div className="import-album-list">
                        {photosAlbums.map(a => (
                          <button
                            key={a.id}
                            className={`import-album-item${selectedAlbumId === a.id ? ' selected' : ''}`}
                            onClick={() => {
                              setSelectedAlbumId(a.id);
                              setCollection(a.name);
                            }}
                          >
                            <span className="import-album-path">{a.name}</span>
                            <span className="import-album-count">{a.count.toLocaleString()}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <label className="import-field">
                    <span>Collection name</span>
                    <input
                      type="text"
                      value={collection}
                      onChange={e => setCollection(e.target.value)}
                      placeholder="My Photos"
                    />
                  </label>

                  <div className="import-options">
                    <label className="import-checkbox">
                      <input
                        type="checkbox"
                        checked={includeNoGps}
                        onChange={e => setIncludeNoGps(e.target.checked)}
                      />
                      Include photos without GPS coordinates
                    </label>
                  </div>
                </>
              )}

              {/* ---- Folder tab ---- */}
              {importType === 'folder' && (
                <div className="import-field">
                  <span>Source directories</span>
                  <div className="import-source-list">
                    {sources.map((src, i) => (
                      <div key={i} className="import-source-item">
                        <input
                          type="text"
                          value={src}
                          onChange={e => {
                            const next = [...sources];
                            next[i] = e.target.value;
                            setSources(next);
                          }}
                          placeholder="/path/to/photos"
                          spellCheck={false}
                        />
                        <button
                          type="button"
                          className="import-source-remove"
                          onClick={() => setSources(sources.filter((_, j) => j !== i))}
                          title="Remove this folder"
                        >
                          ×
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="import-source-add-btn"
                      onClick={() => setBrowserFor('sourceAdd')}
                    >
                      + Add folder
                    </button>
                  </div>
                </div>
              )}

              {/* ---- DigiKam tab ---- */}
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

              {/* Collection name — shared by folder + digikam */}
              {importType !== 'photos' && (
                <label className="import-field">
                  <span>Collection name</span>
                  <input
                    type="text"
                    value={collection}
                    onChange={e => setCollection(e.target.value)}
                    placeholder="My Travels 2024"
                  />
                </label>
              )}

              {/* GPS options — shared by folder + digikam */}
              {importType !== 'photos' && (
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
              )}

              {startErr && <div className="import-error-inline">{startErr}</div>}

              <div className="import-actions">
                {importType !== 'photos' && (
                  <button
                    className="import-btn-secondary"
                    disabled={!canStart}
                    onClick={() => handleStart(true)}
                  >
                    Dry run
                  </button>
                )}
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

            <div className="import-phase-row">
              <span className="import-phase-label">
                {phase === 'done'      ? 'Done'
               : phase === 'cancelled' ? 'Cancelled'
               : phase === 'error'     ? 'Error'
               : job?.phase ?? 'Starting…'}
              </span>
              {job && job.progress.total > 0 && (
                <span className="import-phase-count">
                  {job.progress.done.toLocaleString()}&thinsp;/&thinsp;{job.progress.total.toLocaleString()}
                </span>
              )}
            </div>

            <div className="import-progressbar-track">
              <div
                className={`import-progressbar-fill${phase === 'error' ? ' error' : ''}`}
                style={{ width: phase === 'done' ? '100%' : `${progressPct}%` }}
              />
            </div>

            <div className="import-log" ref={logRef}>
              {(job?.log ?? []).map((line, i) => (
                <div key={i} className="import-log-line">{line}</div>
              ))}
              {phase === 'running' && !job?.log.length && (
                <div className="import-log-line import-log-muted">Starting…</div>
              )}
            </div>

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
                <button className="import-btn-secondary" onClick={handleBack}>
                  ← New import
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
          multiSelect={browserFor === 'sourceAdd'}
          initialPath={
            browserFor === 'sourceAdd'   ? (sources[sources.length - 1] ?? '') :
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
