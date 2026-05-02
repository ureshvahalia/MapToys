import type { ImportJob } from '../../services/api';
import './ImportStatusBar.css';

type ActivePhase = 'running' | 'done' | 'cancelled' | 'error';

interface Props {
  collection: string;
  job:        ImportJob | null;
  phase:      ActivePhase;
  onDetails:  () => void;
  onCancel:   () => void;
  onDismiss:  () => void;
}

export function ImportStatusBar({ collection, job, phase, onDetails, onCancel, onDismiss }: Props) {
  const isDone = phase === 'done' || phase === 'cancelled' || phase === 'error';
  const pct    = job && job.progress.total > 0
    ? Math.round((job.progress.done / job.progress.total) * 100)
    : 0;

  const phaseLabel =
    phase === 'done'      ? 'Done'
    : phase === 'cancelled' ? 'Cancelled'
    : phase === 'error'     ? 'Error'
    : job?.phase ?? 'Starting…';

  return (
    <div className={`isb-bar isb-${phase}`}>
      <span className="isb-dot" />

      <div className="isb-body">
        <div className="isb-top">
          <span className="isb-phase">{phaseLabel}</span>
          {job && job.progress.total > 0 && (
            <span className="isb-count">
              {job.progress.done.toLocaleString()}&thinsp;/&thinsp;{job.progress.total.toLocaleString()}
            </span>
          )}
        </div>
        <div className="isb-collection">{collection}</div>
        <div className="isb-track">
          <div className="isb-fill" style={{ width: phase === 'done' ? '100%' : `${pct}%` }} />
        </div>
      </div>

      <div className="isb-actions">
        <button className="isb-btn isb-btn-details" onClick={onDetails}>Details</button>
        {isDone
          ? <button className="isb-btn isb-btn-dismiss" onClick={onDismiss} title="Dismiss">✕</button>
          : <button className="isb-btn isb-btn-cancel"  onClick={onCancel}>Cancel</button>
        }
      </div>
    </div>
  );
}
