import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getImageUrl, getStory, getVideoBlobUrl } from '../lib/db';
import D20Canvas from '../components/D20Canvas';
import {
  OUTCOME_ORDER,
  OUTCOMES,
  formatTime,
  rollD20,
  rollForOutcomes,
  type Branch,
  type BranchPoint,
  type RollOutcome,
  type Story,
} from '../types/story';

type Phase =
  | { type: 'loading' }
  | { type: 'ready' }
  | { type: 'base' }
  | { type: 'rolling'; pointIndex: number; roll: number }
  | { type: 'result'; pointIndex: number; roll: number; outcome: RollOutcome }
  | { type: 'rollOnly'; pointIndex: number; roll: number }
  | { type: 'rollOnlyResult'; pointIndex: number; roll: number }
  | { type: 'branch'; resumeAt: number }
  | { type: 'end' }
  | { type: 'error'; message: string };

export default function Player() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const [story, setStory] = useState<Story | null>(null);
  const [phase, setPhase] = useState<Phase>({ type: 'loading' });
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [branchSrc, setBranchSrc] = useState<string | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);

  // Playback controls
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(false);
  const [volume, setVolume] = useState(() => {
    const v = Number(localStorage.getItem('fe_volume'));
    return isFinite(v) && v >= 0 && v <= 1 ? v : 1;
  });
  const [muted, setMuted] = useState(() => localStorage.getItem('fe_muted') === '1');
  const [controlsVisible, setControlsVisible] = useState(true);

  const baseVideoRef = useRef<HTMLVideoElement>(null);
  const branchVideoRef = useRef<HTMLVideoElement>(null);
  const urlCache = useRef<Map<string, string>>(new Map());
  const nextPointIndex = useRef(0);
  const resumeAtRef = useRef(0);
  const pendingPlay = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const points = story?.branchPoints ?? [];

  useEffect(() => {
    if (!storyId) return;
    getStory(storyId).then(async s => {
      if (!s) { setPhase({ type: 'error', message: 'Story not found.' }); return; }
      if (!s.baseBlobKey) { setPhase({ type: 'error', message: 'This story has no base video.' }); return; }
      const url = await getVideoBlobUrl(s.baseBlobKey);
      if (!url) { setPhase({ type: 'error', message: 'Base video could not be loaded.' }); return; }
      setStory(s);
      setBaseUrl(url);
      if (s.thumbnailKey) getImageUrl(s.thumbnailKey).then(setPhotoUrl);
      nextPointIndex.current = 0;
      setPhase({ type: 'ready' });
    });
  }, [storyId]);

  function start() {
    nextPointIndex.current = 0;
    const v = baseVideoRef.current;
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    setPhase({ type: 'base' });
  }

  const branchUrl = useCallback(async (branch: Branch): Promise<string | null> => {
    if (!branch.blobKey) return null;
    let url = urlCache.current.get(branch.blobKey);
    if (!url) {
      url = (await getVideoBlobUrl(branch.blobKey)) ?? undefined;
      if (url) urlCache.current.set(branch.blobKey, url);
    }
    return url ?? null;
  }, []);

  const prefetch = useCallback((point: BranchPoint) => {
    for (const branch of Object.values(point.outcomes)) {
      if (branch?.blobKey && !urlCache.current.has(branch.blobKey)) {
        getVideoBlobUrl(branch.blobKey).then(u => { if (u) urlCache.current.set(branch.blobKey!, u); });
      }
    }
  }, []);

  function advancePast(time: number) {
    while (nextPointIndex.current < points.length && points[nextPointIndex.current].time <= time + 0.001) {
      nextPointIndex.current++;
    }
  }

  function onBaseTimeUpdate() {
    const v0 = baseVideoRef.current;
    if (v0) setCurrentTime(v0.currentTime);
    if (phase.type !== 'base') return;
    const i = nextPointIndex.current;
    if (i >= points.length) return;
    const point = points[i];
    const v = baseVideoRef.current;
    if (!v || v.currentTime < point.time) return;
    if (point.kind === 'roll') {
      // Flavor roll — just show a d20 number, then continue.
      v.pause();
      setPhase({ type: 'rollOnly', pointIndex: i, roll: rollD20() });
      return;
    }
    const defined = OUTCOME_ORDER.filter(o => point.outcomes[o]);
    if (defined.length === 0) { advancePast(point.time); return; } // no branches here — keep playing
    v.pause();
    prefetch(point);
    setPhase({ type: 'rolling', pointIndex: i, roll: rollForOutcomes(defined) });
  }

  function onDiceComplete(roll: number, outcome: RollOutcome) {
    setPhase(prev => {
      if (prev.type === 'rolling') return { type: 'result', pointIndex: prev.pointIndex, roll, outcome };
      if (prev.type === 'rollOnly') return { type: 'rollOnlyResult', pointIndex: prev.pointIndex, roll };
      return prev;
    });
  }

  async function onContinue() {
    if (phase.type !== 'result') return;
    const point = points[phase.pointIndex];
    const branch = point.outcomes[phase.outcome];

    const continueBase = () => {
      advancePast(point.time);
      setPhase({ type: 'base' });
      baseVideoRef.current?.play().catch(() => {});
    };

    if (!branch) { continueBase(); return; }
    const url = await branchUrl(branch);
    if (!url) { continueBase(); return; }

    resumeAtRef.current = branch.type === 'replacement'
      ? Math.min(story?.baseDuration || Infinity, point.time + branch.coverDuration)
      : point.time;
    setBranchSrc(url);
    setPhase({ type: 'branch', resumeAt: resumeAtRef.current });
  }

  function continueRoll() {
    if (phase.type !== 'rollOnlyResult') return;
    const point = points[phase.pointIndex];
    advancePast(point.time);
    setPhase({ type: 'base' });
    baseVideoRef.current?.play().catch(() => {});
  }

  // Dispatch the active "Continue" depending on the kind of roll showing.
  function advance() {
    if (phase.type === 'result') onContinue();
    else if (phase.type === 'rollOnlyResult') continueRoll();
  }

  function onBranchEnded() {
    if (phase.type !== 'branch') return;
    const resumeAt = resumeAtRef.current;
    const v = baseVideoRef.current;
    if (v) {
      v.currentTime = resumeAt;
      advancePast(resumeAt);
      setPhase({ type: 'base' });
      v.play().catch(() => {});
    }
  }

  function replay() {
    // The end screen unmounts the base <video>, so the ref is null here. Flag a
    // pending play and let the effect below run it once the video remounts.
    nextPointIndex.current = 0;
    pendingPlay.current = true;
    setPhase({ type: 'base' });
  }

  // Seek-to-start + play once the base video is (re)mounted after a replay.
  useEffect(() => {
    if (phase.type === 'base' && pendingPlay.current) {
      pendingPlay.current = false;
      const v = baseVideoRef.current;
      if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    }
  }, [phase]);

  // Keep both video elements in sync with the chosen volume, and persist it.
  useEffect(() => {
    for (const v of [baseVideoRef.current, branchVideoRef.current]) {
      if (v) { v.volume = volume; v.muted = muted; }
    }
    try {
      localStorage.setItem('fe_volume', String(volume));
      localStorage.setItem('fe_muted', muted ? '1' : '0');
    } catch { /* ignore */ }
  }, [volume, muted, baseUrl, branchSrc, phase]);

  function showControls() {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    if (!paused) hideTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  }

  // Pausing reveals the controls and keeps them up; playing starts the hide timer.
  useEffect(() => {
    if (paused) {
      setControlsVisible(true);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    } else {
      showControls();
    }
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [paused]);

  function activeVideo(): HTMLVideoElement | null {
    return phase.type === 'branch' ? branchVideoRef.current : baseVideoRef.current;
  }

  function togglePlay() {
    const v = activeVideo();
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
  }

  function seekTo(time: number) {
    if (phase.type === 'branch') return; // seeking the base mid-branch is meaningless
    const v = baseVideoRef.current;
    if (!v || !duration) return;
    const t = Math.max(0, Math.min(duration, time));
    v.currentTime = t;
    setCurrentTime(t);
    // Re-arm branch detection: next point is the first one after the new time.
    nextPointIndex.current = points.filter(p => p.time <= t + 0.001).length;
  }

  function toggleMute() {
    setMuted(m => {
      const next = !m;
      if (!next && volume === 0) setVolume(0.5);
      return next;
    });
  }

  function scrub(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = (e.clientX - rect.left) / rect.width;
    seekTo(frac * (duration || story?.baseDuration || 0));
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== ' ') return;
      if (phase.type === 'result' || phase.type === 'rollOnlyResult') {
        e.preventDefault();
        advance();
      } else if (phase.type === 'base' || phase.type === 'branch') {
        e.preventDefault();
        togglePlay();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // Auto-advance if the viewer doesn't click Continue.
  useEffect(() => {
    if (phase.type !== 'result' && phase.type !== 'rollOnlyResult') return;
    const t = setTimeout(() => advance(), 3000);
    return () => clearTimeout(t);
  }, [phase]);

  if (phase.type === 'loading') return <FullScreen><p className="text-gray-600">Loading…</p></FullScreen>;
  if (phase.type === 'error') return (
    <FullScreen>
      <p className="text-red-400 mb-4">{phase.message}</p>
      <button onClick={() => navigate('/')} className="text-sm text-gray-500 hover:text-arcane-700">← Home</button>
    </FullScreen>
  );
  if (phase.type === 'end') {
    return <EndScreen story={story} photoUrl={photoUrl} onReplay={replay} onHome={() => navigate('/')} />;
  }

  const showBranch = phase.type === 'branch';

  const total = duration || story?.baseDuration || 0;
  const progressPct = total ? Math.min(100, (currentTime / total) * 100) : 0;
  const showControlBar = phase.type === 'base' || phase.type === 'branch';

  return (
    <div
      className="min-h-screen bg-black flex flex-col relative overflow-hidden"
      onMouseMove={showControls}
      onTouchStart={showControls}
    >
      <button
        onClick={() => navigate('/')}
        className="absolute top-4 left-4 z-40 p-2 rounded-full bg-black/60 hover:bg-black/90 text-gray-400 hover:text-white transition-colors"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
        </svg>
      </button>

      {story && (
        <div className="absolute top-4 inset-x-0 z-10 flex justify-center pointer-events-none">
          <span className="bg-black/50 backdrop-blur-sm text-xs text-gray-400 px-3 py-1 rounded-full tracking-wide">
            {story.title}
          </span>
        </div>
      )}

      {/* Base video — stays mounted to preserve position; hidden while a branch plays */}
      {baseUrl && (
        <video
          ref={baseVideoRef}
          src={baseUrl}
          playsInline
          onTimeUpdate={onBaseTimeUpdate}
          onLoadedMetadata={e => setDuration(e.currentTarget.duration)}
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={() => setPhase(prev => (prev.type === 'base' ? { type: 'end' } : prev))}
          className="w-full h-screen object-contain bg-black"
          style={{ display: showBranch ? 'none' : 'block' }}
        />
      )}

      {/* Branch clip */}
      {showBranch && branchSrc && (
        <video
          ref={branchVideoRef}
          key={branchSrc}
          src={branchSrc}
          autoPlay
          playsInline
          onPlay={() => setPaused(false)}
          onPause={() => setPaused(true)}
          onEnded={onBranchEnded}
          className="w-full h-screen object-contain bg-black"
        />
      )}

      {/* Play gate — viewer must click before the story begins */}
      {phase.type === 'ready' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <button
            onClick={start}
            className="group flex flex-col items-center gap-4"
            aria-label="Play"
          >
            <span className="flex items-center justify-center w-24 h-24 rounded-full bg-arcane-700/90 group-hover:bg-arcane-600 text-white transition-all group-hover:scale-105 shadow-xl">
              <svg className="w-10 h-10 ml-1.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="text-sm tracking-wide text-gray-300 group-hover:text-white transition-colors">Play</span>
          </button>
        </div>
      )}

      {/* BG3-style dice overlay (branch points) */}
      {(phase.type === 'rolling' || phase.type === 'result') && story && (
        <BG3Overlay
          phase={phase.type}
          roll={phase.roll}
          outcome={phase.type === 'result' ? phase.outcome : null}
          point={points[phase.pointIndex]}
          onDiceComplete={onDiceComplete}
          onContinue={onContinue}
        />
      )}

      {/* Plain flavor-roll overlay (dice-roll points) */}
      {(phase.type === 'rollOnly' || phase.type === 'rollOnlyResult') && story && (
        <PlainRollOverlay
          phase={phase.type}
          roll={phase.roll}
          label={points[phase.pointIndex]?.label}
          onDiceComplete={onDiceComplete}
          onContinue={continueRoll}
        />
      )}

      {/* Bottom progress bar + volume controls */}
      {showControlBar && (
        <div
          className={`absolute bottom-0 inset-x-0 z-40 px-4 pb-4 pt-12 bg-gradient-to-t from-black/85 via-black/40 to-transparent transition-opacity duration-300 ${
            controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Progress track */}
          <div
            className="relative h-1.5 rounded-full bg-white/20 cursor-pointer group/track mb-2.5"
            onPointerDown={e => { e.currentTarget.setPointerCapture(e.pointerId); scrub(e); }}
            onPointerMove={e => { if (e.buttons === 1) scrub(e); }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full bg-arcane-500"
              style={{ width: `${progressPct}%` }}
            />
            {/* Branch-point markers */}
            {total > 0 && points.map(p => (
              <span
                key={p.id}
                className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-gold-400/90"
                style={{ left: `${Math.min(100, (p.time / total) * 100)}%` }}
              />
            ))}
            <div
              className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white shadow opacity-0 group-hover/track:opacity-100 transition-opacity"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2 text-white">
            <button onClick={togglePlay} className="p-1.5 hover:text-arcane-300 transition-colors" aria-label={paused ? 'Play' : 'Pause'}>
              {paused ? <PlayIcon /> : <PauseIcon />}
            </button>
            <button onClick={toggleMute} className="p-1.5 hover:text-arcane-300 transition-colors" aria-label={muted ? 'Unmute' : 'Mute'}>
              {muted || volume === 0 ? <MutedIcon /> : <VolumeIcon />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={muted ? 0 : volume}
              onChange={e => { const val = Number(e.target.value); setVolume(val); setMuted(val === 0); }}
              className="w-20 sm:w-28 accent-arcane-500 cursor-pointer"
              aria-label="Volume"
            />
            <span className="text-xs tabular-nums text-white/70 ml-auto">
              {formatTime(currentTime)} / {formatTime(total)}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Player control icons ─────────────────────────────────────────────────────

function PlayIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>;
}
function PauseIcon() {
  return <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></svg>;
}
function VolumeIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 10v4h4l5 5V5L7 10H3z" />
      <path d="M16 8.5a4 4 0 0 1 0 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
function MutedIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
      <path d="M3 10v4h4l5 5V5L7 10H3z" />
      <path d="M16 9l5 6M21 9l-5 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

// ─── BG3 Dice Overlay ────────────────────────────────────────────────────────

interface BG3OverlayProps {
  phase: 'rolling' | 'result';
  roll: number;
  outcome: RollOutcome | null;
  point: BranchPoint;
  onDiceComplete: (roll: number, outcome: RollOutcome) => void;
  onContinue: () => void;
}

const OUTCOME_GLOW_CLASS: Record<RollOutcome, string> = {
  critFail: 'text-red-400',
  low: 'text-orange-400',
  high: 'text-green-400',
  critSuccess: 'text-yellow-400',
};
const OUTCOME_BTN_CLASS: Record<RollOutcome, string> = {
  critFail: 'bg-red-800/90 hover:bg-red-700 border-red-600/50',
  low: 'bg-orange-800/90 hover:bg-orange-700 border-orange-600/50',
  high: 'bg-green-800/90 hover:bg-green-700 border-green-600/50',
  critSuccess: 'bg-yellow-700/90 hover:bg-yellow-600 border-yellow-500/50',
};
const OUTCOME_SHADOW: Record<RollOutcome, string> = {
  critFail: '#dc2626',
  low: '#ea580c',
  high: '#16a34a',
  critSuccess: '#ca8a04',
};

/** Shared gothic panel chrome used by both the branch overlay and the plain roll. */
function RunePanel({ glowColor, children }: { glowColor?: string; children: React.ReactNode }) {
  const [panelVisible, setPanelVisible] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setPanelVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none"
      style={{ background: 'transparent' }}
    >
      <div
        className="relative w-full max-w-lg mx-4 transition-all duration-500 pointer-events-auto"
        style={{
          transform: panelVisible ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.97)',
          opacity: panelVisible ? 1 : 0,
        }}
      >
        {glowColor && (
          <div
            className="absolute inset-0 rounded-2xl blur-2xl opacity-20 transition-colors duration-700 pointer-events-none"
            style={{ backgroundColor: glowColor }}
          />
        )}

        <div
          className="relative rounded-2xl overflow-hidden"
          style={{
            background: 'linear-gradient(180deg, #0e0b1a 0%, #080612 50%, #0b0918 100%)',
            border: '1px solid rgba(180,140,40,0.35)',
            boxShadow: glowColor
              ? `0 0 60px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,215,0,0.08), 0 0 30px ${glowColor}44`
              : '0 0 60px rgba(0,0,0,0.9), inset 0 1px 0 rgba(255,215,0,0.08)',
          }}
        >
          <div className="absolute inset-[3px] rounded-xl pointer-events-none"
            style={{ border: '1px solid rgba(140,100,20,0.18)' }} />

          <CornerRunes />

          <div className="pt-7 pb-1 px-8 flex items-center gap-3">
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(180,140,40,0.5) 80%)' }} />
            <span className="text-xs font-semibold tracking-[0.3em] uppercase"
              style={{ color: 'rgba(200,165,60,0.85)', fontFamily: 'Palatino Linotype, Palatino, serif' }}>
              Fate's Roll
            </span>
            <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(180,140,40,0.5) 20%, transparent)' }} />
          </div>

          {children}
        </div>
      </div>

      <style>{`
        @keyframes subtleShake {
          0%, 100% { transform: translate(0,0) rotate(0); }
          15% { transform: translate(-2px, 1px) rotate(-0.3deg); }
          30% { transform: translate(2px, -1px) rotate(0.3deg); }
          45% { transform: translate(-1px, 2px) rotate(-0.2deg); }
          60% { transform: translate(1px, -2px) rotate(0.2deg); }
          75% { transform: translate(-2px, 0) rotate(-0.1deg); }
        }
        .animate-subtleShake { animation: subtleShake 0.25s ease-in-out infinite; }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .animate-fadeSlideUp { animation: fadeSlideUp 0.4s ease-out forwards; }
      `}</style>
    </div>
  );
}

function BG3Overlay({ phase, roll, outcome, point, onDiceComplete, onContinue }: BG3OverlayProps) {
  const [resultVisible, setResultVisible] = useState(false);

  useEffect(() => {
    if (phase === 'result') {
      const t = setTimeout(() => setResultVisible(true), 100);
      return () => clearTimeout(t);
    } else {
      setResultVisible(false);
    }
  }, [phase]);

  const glowColor = outcome ? OUTCOME_SHADOW[outcome] : undefined;

  return (
    <RunePanel glowColor={glowColor}>
      <div className={`flex justify-center py-2 ${phase === 'rolling' ? 'animate-subtleShake' : ''}`}>
        <D20Canvas
          rolling={phase === 'rolling'}
          finalRoll={roll}
          onComplete={onDiceComplete}
          size={300}
        />
      </div>

      <div
        className="transition-all duration-500 overflow-hidden"
        style={{ maxHeight: resultVisible ? '120px' : '0px', opacity: resultVisible ? 1 : 0 }}
      >
        {outcome && (
          <div className="text-center pb-2">
            <p
              className={`text-6xl font-black tracking-tight leading-none mb-1.5 ${OUTCOME_GLOW_CLASS[outcome]}`}
              style={{
                fontFamily: 'Palatino Linotype, Palatino, serif',
                textShadow: `0 0 30px ${glowColor}cc, 0 0 60px ${glowColor}66`,
              }}
            >
              {roll}
            </p>
            <p
              className={`text-sm font-semibold tracking-[0.2em] uppercase ${OUTCOME_GLOW_CLASS[outcome]}`}
              style={{ textShadow: `0 0 12px ${glowColor}88` }}
            >
              {OUTCOMES[outcome].label}
            </p>
          </div>
        )}
      </div>

      <div className="mx-6 my-3" style={{ height: 1, background: 'linear-gradient(90deg, transparent, rgba(160,120,40,0.4), transparent)' }} />

      <div className="px-5 pb-4 grid grid-cols-4 gap-2">
        {OUTCOME_ORDER.map(o => {
          const branch = point?.outcomes[o];
          const meta = OUTCOMES[o];
          const isWinner = outcome === o;
          const isDimmed = outcome !== null && !isWinner;

          return (
            <div
              key={o}
              className="rounded-lg p-2 text-center transition-all duration-500"
              style={{
                background: isWinner ? `${OUTCOME_SHADOW[o]}22` : 'rgba(255,255,255,0.03)',
                border: `1px solid ${isWinner ? OUTCOME_SHADOW[o] + '60' : 'rgba(255,255,255,0.06)'}`,
                opacity: isDimmed ? 0.35 : 1,
                boxShadow: isWinner ? `0 0 14px ${OUTCOME_SHADOW[o]}44` : 'none',
                transform: isWinner ? 'scale(1.04)' : 'scale(1)',
              }}
            >
              <p className={`text-[10px] font-bold uppercase tracking-wide mb-0.5 ${meta.color} ${isDimmed ? 'opacity-60' : ''}`}>
                {meta.label}
              </p>
              <p className="text-[9px] text-gray-600">{meta.range}</p>
              <p className="text-[9px] text-gray-500 mt-1 leading-tight truncate">
                {branch ? branch.label || (branch.type === 'replacement' ? 'Replacement' : 'Addition') : 'Continue'}
              </p>
            </div>
          );
        })}
      </div>

      {outcome && resultVisible && (
        <div className="px-6 pb-6 flex flex-col items-center gap-1.5 animate-fadeSlideUp">
          <button
            onClick={onContinue}
            className={`px-8 py-2.5 rounded-xl text-sm font-semibold text-white border transition-all hover:scale-105 active:scale-95 ${OUTCOME_BTN_CLASS[outcome]}`}
            style={{ boxShadow: `0 0 20px ${glowColor}44` }}
          >
            Continue
          </button>
          <span className="text-[10px] text-gray-700 tracking-wider">SPACE to advance</span>
        </div>
      )}
    </RunePanel>
  );
}

// ─── Plain flavor-roll overlay ────────────────────────────────────────────────

interface PlainRollOverlayProps {
  phase: 'rollOnly' | 'rollOnlyResult';
  roll: number;
  label?: string;
  onDiceComplete: (roll: number, outcome: RollOutcome) => void;
  onContinue: () => void;
}

const ROLL_GOLD = '#d9b44a';

function PlainRollOverlay({ phase, roll, label, onDiceComplete, onContinue }: PlainRollOverlayProps) {
  const [resultVisible, setResultVisible] = useState(false);

  useEffect(() => {
    if (phase === 'rollOnlyResult') {
      const t = setTimeout(() => setResultVisible(true), 100);
      return () => clearTimeout(t);
    } else {
      setResultVisible(false);
    }
  }, [phase]);

  return (
    <RunePanel>
      <div className={`flex justify-center py-2 ${phase === 'rollOnly' ? 'animate-subtleShake' : ''}`}>
        <D20Canvas
          rolling={phase === 'rollOnly'}
          finalRoll={roll}
          onComplete={onDiceComplete}
          size={300}
        />
      </div>

      <div
        className="transition-all duration-500 overflow-hidden"
        style={{ maxHeight: resultVisible ? '170px' : '0px', opacity: resultVisible ? 1 : 0 }}
      >
        <div className="text-center pb-2 px-6">
          {label && (
            <p className="text-sm italic text-gray-400 mb-1 font-display truncate">{label}</p>
          )}
          <p
            className="text-7xl font-black tracking-tight leading-none mb-1"
            style={{
              color: ROLL_GOLD,
              fontFamily: 'Palatino Linotype, Palatino, serif',
              textShadow: `0 0 30px ${ROLL_GOLD}cc, 0 0 60px ${ROLL_GOLD}55`,
            }}
          >
            {roll}
          </p>
          <p className="text-[11px] font-semibold tracking-[0.25em] uppercase text-gray-500">
            You rolled a {roll} on a d20
          </p>
        </div>
      </div>

      {resultVisible && (
        <div className="px-6 pb-6 pt-2 flex flex-col items-center gap-1.5 animate-fadeSlideUp">
          <button
            onClick={onContinue}
            className="px-8 py-2.5 rounded-xl text-sm font-semibold text-white border border-arcane-500 bg-arcane-700/90 hover:bg-arcane-600 transition-all hover:scale-105 active:scale-95"
            style={{ boxShadow: `0 0 20px ${ROLL_GOLD}33` }}
          >
            Continue
          </button>
          <span className="text-[10px] text-gray-700 tracking-wider">SPACE to advance</span>
        </div>
      )}
    </RunePanel>
  );
}

// ─── Gothic corner rune decorations ──────────────────────────────────────────

function CornerRunes() {
  const corners = [
    { top: 0, left: 0, transform: 'rotate(0deg)' },
    { top: 0, right: 0, transform: 'rotate(90deg)' },
    { bottom: 0, right: 0, transform: 'rotate(180deg)' },
    { bottom: 0, left: 0, transform: 'rotate(270deg)' },
  ];
  return (
    <>
      {corners.map((style, i) => (
        <svg
          key={i}
          width="28" height="28"
          className="absolute pointer-events-none"
          style={{ ...style as React.CSSProperties }}
          viewBox="0 0 28 28"
          fill="none"
        >
          <path d="M2 14 L2 2 L14 2" stroke="rgba(180,140,40,0.6)" strokeWidth="1.5" fill="none" />
          <circle cx="6" cy="6" r="1.5" fill="rgba(180,140,40,0.5)" />
        </svg>
      ))}
    </>
  );
}

// ─── End screen ───────────────────────────────────────────────────────────────

function EndScreen({ story, photoUrl, onReplay, onHome }: { story: Story | null; photoUrl: string | null; onReplay: () => void; onHome: () => void }) {
  return (
    <div className="min-h-screen bg-void-950 flex items-center justify-center">
      <div className="text-center animate-fade-in px-6">
        {photoUrl && (
          <div className="mb-6 flex justify-center">
            <img
              src={photoUrl}
              alt={story?.title ?? 'Story photo'}
              className="max-h-72 w-auto rounded-xl object-contain shadow-2xl border border-void-600"
            />
          </div>
        )}
        <div className="mb-5 flex justify-center text-gold-500">
          <svg width="56" height="56" viewBox="0 0 24 24" fill="none">
            <path
              d="M12 20.5C12 20.5 3.5 14.8 3.5 8.9C3.5 6.2 5.6 4.2 8.1 4.2C9.8 4.2 11.2 5.1 12 6.5C12.8 5.1 14.2 4.2 15.9 4.2C18.4 4.2 20.5 6.2 20.5 8.9C20.5 14.8 12 20.5 12 20.5Z"
              stroke="currentColor" strokeWidth="1.2" fill="currentColor" fillOpacity="0.14"
            />
          </svg>
        </div>
        <p className="text-[11px] uppercase tracking-[0.4em] text-gold-600 mb-2">Fin</p>
        <h2 className="font-display text-5xl font-medium text-arcane-800 mb-2">The End</h2>
        {story && (
          <p className="text-base text-gray-400 mb-1 italic font-display">{story.title}</p>
        )}
        {story?.author && (
          <p className="text-sm text-gray-500 mb-8">with love, {story.author}</p>
        )}
        {!story?.author && <div className="mb-8" />}
        <div className="flex gap-3 justify-center">
          <button
            onClick={onReplay}
            className="px-6 py-2.5 text-sm font-medium text-white rounded-full bg-arcane-700 hover:bg-arcane-600 transition-colors shadow-sm"
          >
            Watch again
          </button>
          <button
            onClick={onHome}
            className="px-6 py-2.5 text-sm text-gray-500 hover:text-arcane-700 rounded-full border border-void-600 hover:border-arcane-400 transition-colors"
          >
            All stories
          </button>
        </div>
      </div>
    </div>
  );
}

function FullScreen({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-void-950 flex items-center justify-center">{children}</div>
  );
}
