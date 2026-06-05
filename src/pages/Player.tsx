import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getImageUrl, getStory, getVideoBlobUrl } from '../lib/db';
import D20Canvas from '../components/D20Canvas';
import {
  OUTCOME_ORDER,
  OUTCOMES,
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

  const baseVideoRef = useRef<HTMLVideoElement>(null);
  const branchVideoRef = useRef<HTMLVideoElement>(null);
  const urlCache = useRef<Map<string, string>>(new Map());
  const nextPointIndex = useRef(0);
  const resumeAtRef = useRef(0);

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
    if (phase.type !== 'base') return;
    const i = nextPointIndex.current;
    if (i >= points.length) return;
    const point = points[i];
    const v = baseVideoRef.current;
    if (!v || v.currentTime < point.time) return;
    const defined = OUTCOME_ORDER.filter(o => point.outcomes[o]);
    if (defined.length === 0) { advancePast(point.time); return; } // no branches here — keep playing
    v.pause();
    prefetch(point);
    setPhase({ type: 'rolling', pointIndex: i, roll: rollForOutcomes(defined) });
  }

  function onDiceComplete(roll: number, outcome: RollOutcome) {
    setPhase(prev => (prev.type === 'rolling'
      ? { type: 'result', pointIndex: prev.pointIndex, roll, outcome }
      : prev));
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
    nextPointIndex.current = 0;
    const v = baseVideoRef.current;
    if (v) { v.currentTime = 0; v.play().catch(() => {}); }
    setPhase({ type: 'base' });
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === ' ' && phase.type === 'result') { e.preventDefault(); onContinue(); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase]);

  // Auto-advance if the viewer doesn't click Continue.
  useEffect(() => {
    if (phase.type !== 'result') return;
    const t = setTimeout(() => onContinue(), 3000);
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

  return (
    <div className="min-h-screen bg-black flex flex-col relative overflow-hidden">
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

      {/* BG3-style dice overlay */}
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
    </div>
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

function BG3Overlay({ phase, roll, outcome, point, onDiceComplete, onContinue }: BG3OverlayProps) {
  const [panelVisible, setPanelVisible] = useState(false);
  const [resultVisible, setResultVisible] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setPanelVisible(true), 40);
    return () => clearTimeout(t);
  }, []);

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
        {outcome && (
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
            boxShadow: outcome
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
