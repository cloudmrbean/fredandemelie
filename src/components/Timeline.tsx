import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import {
  OUTCOME_ORDER,
  OUTCOMES,
  formatTime,
  type BranchPoint,
} from '../types/story';

interface Props {
  duration: number;
  branchPoints: BranchPoint[];
  selectedPointId: string | null;
  currentTime: number;
  onScrub: (time: number) => void;
  onSelectPoint: (id: string) => void;
  onAddPoint: (time: number) => void;
  onMovePoint: (id: string, time: number) => void;
}

function niceStep(duration: number): number {
  const target = duration / 8; // aim for ~8 labelled ticks
  const steps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  for (const s of steps) if (s >= target) return s;
  return 900;
}

/** Largest base span covered by a replacement branch at this point (0 if none). */
function maxCover(point: BranchPoint): number {
  let max = 0;
  for (const branch of Object.values(point.outcomes)) {
    if (branch?.type === 'replacement') max = Math.max(max, branch.coverDuration);
  }
  return max;
}

export default function Timeline({
  duration,
  branchPoints,
  selectedPointId,
  currentTime,
  onScrub,
  onSelectPoint,
  onAddPoint,
  onMovePoint,
}: Props) {
  const trackRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<string | null>(null);

  const safeDuration = duration > 0 ? duration : 1;
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / safeDuration) * 100))}%`;

  function timeFromClientX(clientX: number): number {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    const frac = (clientX - rect.left) / rect.width;
    return Math.min(safeDuration, Math.max(0, frac * safeDuration));
  }

  function handleScrub(e: ReactPointerEvent) {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    onScrub(timeFromClientX(e.clientX));
  }
  function handleScrubMove(e: ReactPointerEvent) {
    if (e.buttons === 0) return;
    onScrub(timeFromClientX(e.clientX));
  }

  function handleTrackClick(e: ReactPointerEvent) {
    // Clicks on markers stop propagation, so reaching here = empty track.
    if (draggingRef.current) return;
    onAddPoint(timeFromClientX(e.clientX));
  }

  function startMarkerDrag(e: ReactPointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    draggingRef.current = id;
    onSelectPoint(id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function moveMarker(e: ReactPointerEvent, id: string) {
    if (draggingRef.current !== id) return;
    onMovePoint(id, timeFromClientX(e.clientX));
  }
  function endMarkerDrag(e: ReactPointerEvent) {
    draggingRef.current = null;
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }

  const tickStep = niceStep(safeDuration);
  const ticks: number[] = [];
  for (let t = 0; t <= safeDuration + 0.001; t += tickStep) ticks.push(t);

  return (
    <div className="select-none">
      {/* Ruler / scrub zone */}
      <div
        className="relative h-6 cursor-text"
        onPointerDown={handleScrub}
        onPointerMove={handleScrubMove}
      >
        {ticks.map(t => (
          <div
            key={t}
            className="absolute top-0 bottom-0 flex flex-col items-start"
            style={{ left: pct(t) }}
          >
            <div className="w-px h-2 bg-void-600" />
            <span className="text-[10px] text-gray-500 ml-0.5 -translate-x-0 whitespace-nowrap">
              {formatTime(t)}
            </span>
          </div>
        ))}
      </div>

      {/* Track + branch lane */}
      <div
        ref={trackRef}
        onPointerDown={handleTrackClick}
        className="relative h-24 rounded-lg border border-void-700 bg-void-900/50 overflow-hidden cursor-copy"
      >
        {/* Base video band */}
        <div className="absolute inset-x-0 top-0 h-10 bg-gradient-to-b from-arcane-200 to-arcane-100 border-b border-void-700 flex items-center px-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-arcane-700/80">
            Base video
          </span>
        </div>

        {/* Replacement coverage spans (on the base band) */}
        {branchPoints.map(point => {
          const cover = maxCover(point);
          if (cover <= 0) return null;
          return (
            <div
              key={`cover-${point.id}`}
              className="absolute top-0 h-10 bg-red-400/25 border-x border-red-400/60 pointer-events-none"
              style={{ left: pct(point.time), width: pct(Math.min(cover, safeDuration - point.time)) }}
            />
          );
        })}

        {/* Branch markers */}
        {branchPoints.map(point => {
          const isSelected = point.id === selectedPointId;
          const filled = OUTCOME_ORDER.filter(o => point.outcomes[o]);
          return (
            <div
              key={point.id}
              className="absolute top-0 bottom-0"
              style={{ left: pct(point.time) }}
            >
              {/* Vertical line */}
              <div
                className={`absolute top-0 bottom-0 w-px -translate-x-1/2 ${
                  isSelected ? 'bg-arcane-400' : 'bg-arcane-600/60'
                }`}
              />
              {/* Draggable head */}
              <div
                onPointerDown={e => startMarkerDrag(e, point.id)}
                onPointerMove={e => moveMarker(e, point.id)}
                onPointerUp={endMarkerDrag}
                className={`absolute top-10 -translate-x-1/2 cursor-grab active:cursor-grabbing rounded-md px-1.5 py-1 border text-[10px] whitespace-nowrap transition-colors ${
                  isSelected
                    ? 'bg-arcane-700 border-arcane-400 text-white'
                    : 'bg-void-800 border-arcane-700/50 text-arcane-700 hover:border-arcane-500'
                }`}
                title={`${point.label} · ${formatTime(point.time)}`}
              >
                <span className="font-medium">⬦ {point.label || 'Branch'}</span>
                {filled.length > 0 && (
                  <span className="ml-1 inline-flex gap-0.5 align-middle">
                    {filled.map(o => (
                      <span
                        key={o}
                        className={`inline-block w-1.5 h-1.5 rounded-full ${OUTCOMES[o].color}`}
                        style={{ backgroundColor: 'currentColor' }}
                      />
                    ))}
                  </span>
                )}
              </div>
            </div>
          );
        })}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-arcane-600 pointer-events-none z-10"
          style={{ left: pct(currentTime) }}
        >
          <div className="absolute -top-0 -translate-x-1/2 w-2.5 h-2.5 rotate-45 bg-arcane-600" />
        </div>
      </div>

      <p className="mt-1.5 text-[11px] text-gray-600">
        Click the track to add a branch point · drag a marker to move it · drag the ruler to scrub
      </p>
    </div>
  );
}
