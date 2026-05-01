import { useRef, useState, useLayoutEffect, useCallback, useEffect, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { scaleTime } from 'd3-scale';
import { timeYear, timeMonth, timeDay, timeHour, timeMinute } from 'd3-time';
import { timeFormat } from 'd3-time-format';
import './TimelineTrack.css';
import type { TrackEdge } from '../../types';

// ---- Constants ----------------------------------------------------------------

const TRACK_SIZE  = 80;   // cross-axis thickness (must match --track-size in CSS)
const HANDLE_R    = 7;    // radius of bracket-handle circles
const HIT_SLOP    = 14;   // extra px around handle for easier clicking
const MIN_WIN_PX  = 20;   // minimum window width/height in pixels
const AXIS_CROSS  = 34;   // px from the edge where the axis line sits

// ---- Default state ------------------------------------------------------------

const D_VIEW_START = new Date('1950-01-01');
const D_VIEW_END   = new Date('2030-01-01');
const D_WIN_START  = new Date('2024-01-01');
const D_WIN_END    = new Date('2026-01-01');

// ---- Types -------------------------------------------------------------------

type DragTarget = 'left' | 'right' | 'center' | 'pan';

interface DragState {
  target:         DragTarget;
  startPx:        number;     // SVG-local position at drag start (for hit logging)
  startClientPos: number;     // raw clientX or clientY (delta source — no rect needed)
  isV:            boolean;
  startTrackPx:   number;
  startWinStart:  Date;
  startWinEnd:    Date;
  startViewStart: Date;
  startViewEnd:   Date;
}

interface Props {
  edge:           TrackEdge;
  onEdgeChange:   (edge: TrackEdge) => void;
  onWindowChange?: (start: Date, end: Date) => void;
}

// ---- Helpers -----------------------------------------------------------------

function useSize(ref: RefObject<HTMLDivElement>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    if (!ref.current) return;
    const obs = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, [ref]);
  return size;
}

function getTickCfg(vStart: Date, vEnd: Date, px: number) {
  if (px <= 0) return null;
  const t = (vEnd.getTime() - vStart.getTime()) / px * 80; // ms per ~80px
  const M = 6e4, H = 36e5, D = 864e5, Mo = 2.628e9, Y = 3.156e10;
  if (t > 20*Y)  return { iv: timeYear.every(50)!,   fmt: '%Y'    };
  if (t >  5*Y)  return { iv: timeYear.every(10)!,   fmt: '%Y'    };
  if (t >    Y)  return { iv: timeYear.every(2)!,    fmt: '%Y'    };
  if (t > .4*Y)  return { iv: timeYear.every(1)!,    fmt: '%Y'    };
  if (t >  2*Mo) return { iv: timeMonth.every(3)!,   fmt: '%b %Y' };
  if (t > .5*Mo) return { iv: timeMonth.every(1)!,   fmt: "%b '%y"};
  if (t >  7*D)  return { iv: timeDay.every(14)!,    fmt: '%d %b' };
  if (t >    D)  return { iv: timeDay.every(7)!,     fmt: '%d %b' };
  if (t > .3*D)  return { iv: timeDay.every(1)!,     fmt: '%d %b' };
  if (t >  6*H)  return { iv: timeHour.every(12)!,   fmt: '%H:%M' };
  if (t >    H)  return { iv: timeHour.every(6)!,    fmt: '%H:%M' };
  if (t > .3*H)  return { iv: timeHour.every(1)!,    fmt: '%H:%M' };
  if (t > 10*M)  return { iv: timeMinute.every(30)!, fmt: '%H:%M' };
  return           { iv: timeMinute.every(5)!,       fmt: '%H:%M' };
}

function clamp(v: number, lo: number, hi: number) { return v < lo ? lo : v > hi ? hi : v; }

const EDGE_ARROWS: Record<TrackEdge, string> = { top: '↑', bottom: '↓', left: '←', right: '→' };
const ALL_EDGES: TrackEdge[] = ['top', 'bottom', 'left', 'right'];

function nearestEdge(x: number, y: number): TrackEdge {
  const d = {
    top:    y,
    bottom: window.innerHeight - y,
    left:   x,
    right:  window.innerWidth  - x,
  };
  return (Object.keys(d) as TrackEdge[]).reduce((a, b) => d[a] < d[b] ? a : b);
}

// ---- Component ---------------------------------------------------------------

export function TimelineTrack({ edge, onEdgeChange, onWindowChange }: Props) {
  const isV = edge === 'left' || edge === 'right';

  const containerRef = useRef<HTMLDivElement>(null);
  const { width, height } = useSize(containerRef);
  const trackPx = isV ? height : width;

  const [viewStart, setViewStart] = useState(D_VIEW_START);
  const [viewEnd,   setViewEnd]   = useState(D_VIEW_END);
  const [winStart,  setWinStart]  = useState(D_WIN_START);
  const [winEnd,    setWinEnd]    = useState(D_WIN_END);

  const dragRef      = useRef<DragState | null>(null);
  const edgeDragRef  = useRef<{ startX: number; startY: number } | null>(null);
  const [ghostEdge, setGhostEdge] = useState<TrackEdge | null>(null);
  const dragCount    = useRef(0);
  const moveLoggedRef = useRef(false);

  const scale = scaleTime([viewStart, viewEnd], [0, trackPx]);

  const winSPx = clamp(scale(winStart), 0, trackPx);
  const winEPx = clamp(scale(winEnd),   0, trackPx);
  const winWPx = Math.max(0, winEPx - winSPx);

  // ---- Scroll-to-zoom -------------------------------------------------------
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    if (dragRef.current) return;
    if (!containerRef.current || trackPx <= 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const pos  = isV ? e.clientY - rect.top : e.clientX - rect.left;
    const frac = clamp(pos / trackPx, 0, 1);
    const k    = e.deltaY > 0 ? 1.3 : 1 / 1.3;
    const span = viewEnd.getTime() - viewStart.getTime();
    const pivot = viewStart.getTime() + frac * span;
    setViewStart(new Date(pivot - frac       * span * k));
    setViewEnd  (new Date(pivot + (1 - frac) * span * k));
  }, [isV, trackPx, viewStart, viewEnd]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  // ---- Pointer drag ---------------------------------------------------------
  // onPointerDown runs as a React event to read current render state (winSPx etc.)
  // and populate dragRef. All subsequent move/up handling runs via document-level
  // capture listeners so MapLibre cannot steal the pointer or intercept events.
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const px   = isV ? e.clientY - rect.top : e.clientX - rect.left;
    const hit  = HANDLE_R + HIT_SLOP;

    const distS  = Math.abs(px - winSPx);
    const distE  = Math.abs(px - winEPx);
    // Inside the window use only the visual handle radius so interior clicks
    // reach 'center'. Outside, keep the full hit zone for easy grabbing.
    const inward = px >= winSPx && px <= winEPx;
    const effHit = inward ? HANDLE_R : hit;

    let target: DragTarget;
    if      (distS < effHit && distS <= distE) target = 'left';
    else if (distE < effHit)                   target = 'right';
    else if (inward)                           target = 'center';
    else                                       target = 'pan';

    dragCount.current += 1;
    console.log(`[TL drag #${dragCount.current}] DOWN target=${target} clientX=${e.clientX.toFixed(1)} px=${px.toFixed(1)} trackPx=${trackPx} winS=${winStart.getFullYear()}-${winStart.getMonth()+1} winE=${winEnd.getFullYear()}-${winEnd.getMonth()+1} viewS=${viewStart.getFullYear()} viewE=${viewEnd.getFullYear()}`);

    dragRef.current = {
      target,
      startPx:        px,
      startClientPos: isV ? e.clientY : e.clientX,
      isV,
      startTrackPx:   trackPx,
      startWinStart:  winStart,
      startWinEnd:    winEnd,
      startViewStart: viewStart,
      startViewEnd:   viewEnd,
    };
  };

  // Document-level capture handlers — registered once for the component lifetime.
  // capture:true means these fire before MapLibre's listeners, and they continue
  // receiving events even when MapLibre calls setPointerCapture on its canvas.
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;

      const clientPos = d.isV ? e.clientY : e.clientX;
      const deltaPx   = clientPos - d.startClientPos;
      const msPerPx   = (d.startViewEnd.getTime() - d.startViewStart.getTime()) / d.startTrackPx;
      const deltaMs   = deltaPx * msPerPx;

      if (!moveLoggedRef.current || Math.abs(deltaPx) > 5) {
        moveLoggedRef.current = true;
        console.log(`[TL MOVE] clientPos=${clientPos.toFixed(1)} startClientPos=${d.startClientPos.toFixed(1)} deltaPx=${deltaPx.toFixed(1)} deltaYrs=${(deltaMs / (365.25 * 864e5)).toFixed(2)}`);
      }

      if (d.target === 'left') {
        const next = new Date(d.startWinStart.getTime() + deltaMs);
        const lo   = d.startViewStart;
        const hi   = new Date(d.startWinEnd.getTime() - MIN_WIN_PX * msPerPx);
        setWinStart(next < lo ? lo : next > hi ? hi : next);

      } else if (d.target === 'right') {
        const next = new Date(d.startWinEnd.getTime() + deltaMs);
        const lo   = new Date(d.startWinStart.getTime() + MIN_WIN_PX * msPerPx);
        const hi   = d.startViewEnd;
        setWinEnd(next < lo ? lo : next > hi ? hi : next);

      } else if (d.target === 'center') {
        const span        = d.startWinEnd.getTime() - d.startWinStart.getTime();
        const viewStartMs = d.startViewStart.getTime();
        const viewEndMs   = d.startViewEnd.getTime();
        let newS = d.startWinStart.getTime() + deltaMs;
        let newE = newS + span;
        if (newS < viewStartMs) { newS = viewStartMs; newE = viewStartMs + span; }
        if (newE > viewEndMs)   { newE = viewEndMs;   newS = viewEndMs   - span; }
        setWinStart(new Date(newS));
        setWinEnd  (new Date(newE));

      } else { // pan
        const span = d.startViewEnd.getTime() - d.startViewStart.getTime();
        setViewStart(new Date(d.startViewStart.getTime() - deltaMs));
        setViewEnd  (new Date(d.startViewStart.getTime() - deltaMs + span));
      }
    };

    const onUp = (e: PointerEvent) => {
      if (!dragRef.current) return;
      console.log(`[TL UP] pointerId=${e.pointerId} target=${dragRef.current.target} type=${e.type}`);
      dragRef.current = null;
      moveLoggedRef.current = false;
    };

    document.addEventListener('pointermove',   onMove, { capture: true });
    document.addEventListener('pointerup',     onUp,   { capture: true });
    document.addEventListener('pointercancel', onUp,   { capture: true });
    return () => {
      document.removeEventListener('pointermove',   onMove, true);
      document.removeEventListener('pointerup',     onUp,   true);
      document.removeEventListener('pointercancel', onUp,   true);
    };
  }, []); // setState functions are stable; all drag state read from dragRef

  // ---- Edge drag (grip handle → ghost preview) ------------------------------
  const onGripDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
    edgeDragRef.current = { startX: e.clientX, startY: e.clientY };
  };

  const onGripMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!edgeDragRef.current) return;
    const { startX, startY } = edgeDragRef.current;
    if (Math.hypot(e.clientX - startX, e.clientY - startY) > 16) {
      setGhostEdge(nearestEdge(e.clientX, e.clientY));
    }
  };

  const onGripUp = () => {
    const target = ghostEdge;
    edgeDragRef.current = null;
    setGhostEdge(null);
    if (target !== null && target !== edge) onEdgeChange(target);
  };

  // ---- Notify parent --------------------------------------------------------
  useEffect(() => { onWindowChange?.(winStart, winEnd); }, [winStart, winEnd, onWindowChange]);

  // ---- Tick generation ------------------------------------------------------
  const cfg   = getTickCfg(viewStart, viewEnd, trackPx);
  const ticks = cfg ? cfg.iv.range(viewStart, viewEnd).map(d => ({
    d, px: scale(d), lbl: timeFormat(cfg.fmt)(d),
  })) : [];

  // ---- Window label ---------------------------------------------------------
  const winLabel = cfg
    ? `${timeFormat(cfg.fmt)(winStart)} – ${timeFormat(cfg.fmt)(winEnd)}`
    : '';
  const winMidPx = (winSPx + winEPx) / 2;

  // ---- SVG dimensions -------------------------------------------------------
  const svgW = isV ? TRACK_SIZE : trackPx;
  const svgH = isV ? trackPx   : TRACK_SIZE;

  // ---- Render ---------------------------------------------------------------
  return (
    <div className={`timeline-track edge-${edge}`} ref={containerRef}>
      {trackPx > 0 && (
        <svg
          width={svgW} height={svgH}
          style={{ display: 'block', touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onDoubleClick={() => { setViewStart(D_VIEW_START); setViewEnd(D_VIEW_END); }}
        >
          {/* Transparent background catch-all for pan */}
          <rect width={svgW} height={svgH} fill="transparent" style={{ cursor: 'grab' }} />

          {/* Axis rule */}
          {isV
            ? <line x1={AXIS_CROSS} y1={0} x2={AXIS_CROSS} y2={svgH} stroke="rgba(255,255,255,0.10)" />
            : <line x1={0} y1={AXIS_CROSS} x2={svgW} y2={AXIS_CROSS} stroke="rgba(255,255,255,0.10)" />
          }

          {/* Tick marks + labels */}
          {ticks.map(({ d, px, lbl }) => (
            <g key={d.getTime()} transform={isV ? `translate(0,${px})` : `translate(${px},0)`}>
              {isV ? (
                <>
                  <line x1={AXIS_CROSS - 4} y1={0} x2={AXIS_CROSS + 4} y2={0}
                    stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
                  <text x={AXIS_CROSS + 9} y={0} dominantBaseline="middle"
                    fill="rgba(255,255,255,0.50)" fontSize={10}>{lbl}</text>
                </>
              ) : (
                <>
                  <line x1={0} y1={AXIS_CROSS - 4} x2={0} y2={AXIS_CROSS + 4}
                    stroke="rgba(255,255,255,0.35)" strokeWidth={1} />
                  <text x={3} y={AXIS_CROSS - 8}
                    fill="rgba(255,255,255,0.50)" fontSize={10}>{lbl}</text>
                </>
              )}
            </g>
          ))}

          {/* Window highlight */}
          {isV ? (
            <rect x={4} y={winSPx} width={TRACK_SIZE - 8} height={winWPx}
              fill="rgba(80,140,255,0.18)" style={{ cursor: 'grab' }} />
          ) : (
            <rect x={winSPx} y={4} width={winWPx} height={TRACK_SIZE - 8}
              fill="rgba(80,140,255,0.18)" style={{ cursor: 'grab' }} />
          )}

          {/* Start handle */}
          <g transform={isV ? `translate(0,${winSPx})` : `translate(${winSPx},0)`}
             style={{ cursor: isV ? 'ns-resize' : 'ew-resize' }}>
            {isV
              ? <line x1={4} y1={0} x2={TRACK_SIZE - 4} y2={0} stroke="rgba(100,160,255,0.85)" strokeWidth={2} />
              : <line x1={0} y1={4} x2={0} y2={TRACK_SIZE - 4} stroke="rgba(100,160,255,0.85)" strokeWidth={2} />
            }
            <circle
              cx={isV ? TRACK_SIZE / 2 : 0}
              cy={isV ? 0 : TRACK_SIZE / 2}
              r={HANDLE_R} fill="rgba(100,160,255,0.9)" />
          </g>

          {/* End handle */}
          <g transform={isV ? `translate(0,${winEPx})` : `translate(${winEPx},0)`}
             style={{ cursor: isV ? 'ns-resize' : 'ew-resize' }}>
            {isV
              ? <line x1={4} y1={0} x2={TRACK_SIZE - 4} y2={0} stroke="rgba(100,160,255,0.85)" strokeWidth={2} />
              : <line x1={0} y1={4} x2={0} y2={TRACK_SIZE - 4} stroke="rgba(100,160,255,0.85)" strokeWidth={2} />
            }
            <circle
              cx={isV ? TRACK_SIZE / 2 : 0}
              cy={isV ? 0 : TRACK_SIZE / 2}
              r={HANDLE_R} fill="rgba(100,160,255,0.9)" />
          </g>

          {/* Window range label */}
          {winWPx > 70 && (
            isV ? (
              <text
                x={TRACK_SIZE / 2} y={winMidPx}
                textAnchor="middle" dominantBaseline="middle"
                fontSize={9} fill="rgba(255,255,255,0.55)"
                transform={`rotate(-90,${TRACK_SIZE / 2},${winMidPx})`}
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {winLabel}
              </text>
            ) : (
              <text
                x={winMidPx} y={TRACK_SIZE - 7}
                textAnchor="middle"
                fontSize={9} fill="rgba(255,255,255,0.55)"
                style={{ pointerEvents: 'none', userSelect: 'none' }}>
                {winLabel}
              </text>
            )
          )}
        </svg>
      )}

      {/* Grip handle — drag to reposition */}
      <div
        className={`tl-grip ${isV ? 'tl-grip-v' : ''}`}
        onPointerDown={onGripDown}
        onPointerMove={onGripMove}
        onPointerUp={onGripUp}
        onPointerCancel={onGripUp}
        title="Drag to move timeline to another edge"
      >
        <GripDots vertical={isV} />
      </div>

      {/* Edge switcher buttons (click alternative to drag) */}
      <div className="tl-edge-switcher">
        {ALL_EDGES.filter(e => e !== edge).map(e => (
          <button key={e} className="tl-edge-btn" onClick={() => onEdgeChange(e)} title={`Move to ${e}`}>
            {EDGE_ARROWS[e]}
          </button>
        ))}
      </div>

      {/* Ghost overlay — rendered into document.body so it escapes the track clip */}
      {ghostEdge !== null && createPortal(
        <div className={`tl-ghost tl-ghost-${ghostEdge}`} />,
        document.body,
      )}
    </div>
  );
}

// ---- Grip icon ---------------------------------------------------------------

function GripDots({ vertical }: { vertical: boolean }) {
  const cols = 2, rows = 3;
  const gap = 4, r = 1.5;
  const w = (cols - 1) * gap + r * 2;
  const h = (rows - 1) * gap + r * 2;
  return (
    <svg
      width={vertical ? h : w}
      height={vertical ? w : h}
      viewBox={`0 0 ${w} ${h}`}
      style={vertical ? { transform: 'rotate(90deg)' } : undefined}
    >
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={col * gap + r} cy={row * gap + r} r={r}
            fill="currentColor"
          />
        ))
      )}
    </svg>
  );
}
