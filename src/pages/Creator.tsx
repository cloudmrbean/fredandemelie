import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { getStory, saveStory, saveVideo, getVideoBlobUrl, deleteVideo } from '../lib/db';
import { useUnlocked } from '../lib/auth';
import VideoUploader from '../components/VideoUploader';
import Timeline from '../components/Timeline';
import {
  OUTCOME_ORDER,
  OUTCOMES,
  formatTime,
  makeBranch,
  type Branch,
  type BranchPoint,
  type RollOutcome,
  type Story,
} from '../types/story';

export default function Creator() {
  const { storyId } = useParams<{ storyId: string }>();
  const navigate = useNavigate();
  const unlocked = useUnlocked();

  const [story, setStory] = useState<Story | null>(null);
  const [selectedPointId, setSelectedPointId] = useState<string | null>(null);
  const [videoUrls, setVideoUrls] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const baseVideoRef = useRef<HTMLVideoElement>(null);

  // Editing is locked → send viewers back home (the editor is write-only).
  useEffect(() => {
    if (!unlocked) navigate('/');
  }, [unlocked, navigate]);

  useEffect(() => {
    if (!storyId) return;
    getStory(storyId).then(s => {
      if (!s) { navigate('/'); return; }
      setStory(s);
    });
  }, [storyId, navigate]);

  // Load object URLs for the base video and every branch clip, keyed by blobKey.
  useEffect(() => {
    if (!story) return;
    let cancelled = false;
    const keys = new Set<string>();
    if (story.baseBlobKey) keys.add(story.baseBlobKey);
    for (const point of story.branchPoints) {
      for (const branch of Object.values(point.outcomes)) {
        if (branch?.blobKey) keys.add(branch.blobKey);
      }
    }
    async function loadUrls() {
      const entries = await Promise.all(
        [...keys].map(async key => [key, await getVideoBlobUrl(key)] as const),
      );
      if (cancelled) return;
      setVideoUrls(prev => {
        const map = { ...prev };
        for (const [key, url] of entries) if (url) map[key] = url;
        return map;
      });
    }
    loadUrls();
    return () => { cancelled = true; };
  }, [story]);

  const persistStory = useCallback(async (updated: Story) => {
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    setSaving(true);
    saveTimeoutRef.current = setTimeout(async () => {
      try {
        await saveStory({ ...updated, updatedAt: Date.now() });
      } catch (err) {
        console.error('Failed to save story', err);
      } finally {
        setSaving(false);
      }
    }, 600);
  }, []);

  function updateStory(updater: (prev: Story) => Story) {
    setStory(prev => {
      if (!prev) return prev;
      const next = updater(prev);
      persistStory(next);
      return next;
    });
  }

  // --- Video uploads ---

  async function uploadVideo(slot: string, file: File, assign: (key: string) => void, oldKey: string | null) {
    setUploading(slot);
    const key = uuidv4();
    await saveVideo(key, file);
    const url = URL.createObjectURL(file);
    setVideoUrls(prev => ({ ...prev, [key]: url }));
    if (oldKey) deleteVideo(oldKey);
    assign(key);
    setUploading(null);
  }

  function handleBaseUpload(file: File) {
    const oldKey = story?.baseBlobKey ?? null;
    uploadVideo('base', file, key => {
      updateStory(prev => ({ ...prev, baseBlobKey: key, baseDuration: 0 }));
    }, oldKey);
  }

  function handleBranchUpload(pointId: string, outcome: RollOutcome, file: File) {
    const oldKey = story?.branchPoints.find(p => p.id === pointId)?.outcomes[outcome]?.blobKey ?? null;
    uploadVideo(`${pointId}:${outcome}`, file, key => {
      patchBranch(pointId, outcome, { blobKey: key });
    }, oldKey);
  }

  // --- Branch point operations ---

  function sortPoints(points: BranchPoint[]): BranchPoint[] {
    return [...points].sort((a, b) => a.time - b.time);
  }

  function addPoint(time: number) {
    const id = uuidv4();
    updateStory(prev => {
      const point: BranchPoint = {
        id,
        kind: 'branch',
        time,
        label: `Branch ${prev.branchPoints.length + 1}`,
        outcomes: {},
      };
      return { ...prev, branchPoints: sortPoints([...prev.branchPoints, point]) };
    });
    setSelectedPointId(id);
  }

  function movePoint(id: string, time: number) {
    updateStory(prev => ({
      ...prev,
      branchPoints: sortPoints(prev.branchPoints.map(p => (p.id === id ? { ...p, time } : p))),
    }));
  }

  function deletePoint(id: string) {
    updateStory(prev => {
      const point = prev.branchPoints.find(p => p.id === id);
      if (point) {
        for (const branch of Object.values(point.outcomes)) {
          if (branch?.blobKey) deleteVideo(branch.blobKey);
        }
      }
      return { ...prev, branchPoints: prev.branchPoints.filter(p => p.id !== id) };
    });
    setSelectedPointId(prev => (prev === id ? null : prev));
  }

  function patchPoint(id: string, patch: Partial<Pick<BranchPoint, 'label' | 'time' | 'kind'>>) {
    updateStory(prev => ({
      ...prev,
      branchPoints: sortPoints(prev.branchPoints.map(p => (p.id === id ? { ...p, ...patch } : p))),
    }));
  }

  function addBranch(pointId: string, outcome: RollOutcome) {
    updateStory(prev => ({
      ...prev,
      branchPoints: prev.branchPoints.map(p =>
        p.id === pointId
          ? { ...p, outcomes: { ...p.outcomes, [outcome]: makeBranch(OUTCOMES[outcome].label) } }
          : p,
      ),
    }));
  }

  function patchBranch(pointId: string, outcome: RollOutcome, patch: Partial<Branch>) {
    updateStory(prev => ({
      ...prev,
      branchPoints: prev.branchPoints.map(p => {
        if (p.id !== pointId) return p;
        const existing = p.outcomes[outcome];
        if (!existing) return p;
        return { ...p, outcomes: { ...p.outcomes, [outcome]: { ...existing, ...patch } } };
      }),
    }));
  }

  function removeBranch(pointId: string, outcome: RollOutcome) {
    updateStory(prev => ({
      ...prev,
      branchPoints: prev.branchPoints.map(p => {
        if (p.id !== pointId) return p;
        const branch = p.outcomes[outcome];
        if (branch?.blobKey) deleteVideo(branch.blobKey);
        const outcomes = { ...p.outcomes };
        delete outcomes[outcome];
        return { ...p, outcomes };
      }),
    }));
  }

  function scrubTo(time: number) {
    if (baseVideoRef.current) baseVideoRef.current.currentTime = time;
    setCurrentTime(time);
  }

  if (!story) {
    return <div className="min-h-screen bg-void-950 flex items-center justify-center text-gray-600">Loading…</div>;
  }

  const baseUrl = story.baseBlobKey ? videoUrls[story.baseBlobKey] : undefined;
  const selectedPoint = story.branchPoints.find(p => p.id === selectedPointId) ?? null;

  return (
    <div className="min-h-screen bg-void-950 flex flex-col">
      {/* Top bar */}
      <header className="border-b border-void-700 bg-void-900/40 px-4 py-3 flex items-center gap-4">
        <button
          onClick={() => navigate('/')}
          className="text-gray-500 hover:text-arcane-700 transition-colors"
          title="Back to home"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
          </svg>
        </button>
        <div className="flex-1 min-w-0">
          <input
            value={story.title}
            onChange={e => updateStory(prev => ({ ...prev, title: e.target.value }))}
            className="w-full bg-transparent font-display text-2xl font-medium text-arcane-800 outline-none border-b border-transparent hover:border-void-600 focus:border-arcane-500 transition-colors py-0.5 min-w-0 placeholder:text-gray-600"
            placeholder="Story title…"
          />
          <input
            value={story.author}
            onChange={e => updateStory(prev => ({ ...prev, author: e.target.value }))}
            className="w-full bg-transparent text-sm italic text-gray-500 outline-none border-b border-transparent hover:border-void-600 focus:border-arcane-500 transition-colors py-0.5 min-w-0 placeholder:text-gray-600"
            placeholder="By — your name"
          />
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-xs transition-colors ${saving ? 'text-arcane-600' : 'text-gray-600'}`}>
            {saving ? 'Saving…' : 'Saved'}
          </span>
          <button
            onClick={() => navigate(`/play/${story.id}`)}
            disabled={!story.baseBlobKey}
            className="px-4 py-1.5 bg-arcane-700 hover:bg-arcane-600 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm rounded-lg font-medium transition-colors flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
            Preview
          </button>
        </div>
      </header>

      <main className="flex-1 overflow-y-auto scrollbar-thin">
        <div className="max-w-4xl mx-auto px-6 py-6">
          {!baseUrl ? (
            // --- No base video yet ---
            <div className="py-10">
              <h2 className="font-display text-2xl font-medium text-arcane-800 mb-1">Add the base video</h2>
              <p className="text-sm text-gray-500 mb-5">
                This is the heart of your story. Once it's in, drop moments on the timeline where fate can take over.
              </p>
              {uploading === 'base' ? (
                <div className="rounded-xl border border-void-700 bg-void-800/30 h-40 flex items-center justify-center text-gray-500 text-sm">
                  Uploading…
                </div>
              ) : (
                <VideoUploader onUpload={handleBaseUpload} />
              )}
            </div>
          ) : (
            <>
              {/* Preview */}
              <div className="rounded-xl overflow-hidden border border-void-700 bg-black mb-4">
                <video
                  ref={baseVideoRef}
                  src={baseUrl}
                  controls
                  onLoadedMetadata={e => {
                    const d = e.currentTarget.duration;
                    if (isFinite(d) && d > 0 && Math.abs(d - story.baseDuration) > 0.1) {
                      updateStory(prev => ({ ...prev, baseDuration: d }));
                    }
                  }}
                  onTimeUpdate={e => setCurrentTime(e.currentTarget.currentTime)}
                  className="w-full max-h-72 object-contain bg-black"
                />
                <div className="px-3 py-2 bg-void-800/50 flex items-center justify-between">
                  <span className="text-xs text-gray-500">
                    Base video · {formatTime(story.baseDuration)}
                  </span>
                  <VideoUploader onUpload={handleBaseUpload} currentFileName="Replace" compact />
                </div>
              </div>

              {/* Timeline */}
              <div className="mb-6">
                <Timeline
                  duration={story.baseDuration}
                  branchPoints={story.branchPoints}
                  selectedPointId={selectedPointId}
                  currentTime={currentTime}
                  onScrub={scrubTo}
                  onSelectPoint={setSelectedPointId}
                  onAddPoint={addPoint}
                  onMovePoint={movePoint}
                />
              </div>

              {/* Branch-point editor */}
              {selectedPoint ? (
                <BranchPointEditor
                  point={selectedPoint}
                  baseDuration={story.baseDuration}
                  videoUrls={videoUrls}
                  uploading={uploading}
                  onPatchPoint={patch => patchPoint(selectedPoint.id, patch)}
                  onDeletePoint={() => deletePoint(selectedPoint.id)}
                  onAddBranch={o => addBranch(selectedPoint.id, o)}
                  onPatchBranch={(o, patch) => patchBranch(selectedPoint.id, o, patch)}
                  onRemoveBranch={o => removeBranch(selectedPoint.id, o)}
                  onUploadBranch={(o, file) => handleBranchUpload(selectedPoint.id, o, file)}
                  onSeek={scrubTo}
                />
              ) : (
                <div className="rounded-xl border border-dashed border-void-700 bg-void-900/30 p-8 text-center">
                  <p className="text-sm text-gray-400">
                    {story.branchPoints.length === 0
                      ? 'No branch points yet. Click the timeline track to add one.'
                      : 'Select a branch point on the timeline to edit its outcomes.'}
                  </p>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// --- Branch point editor ---

interface BranchPointEditorProps {
  point: BranchPoint;
  baseDuration: number;
  videoUrls: Record<string, string>;
  uploading: string | null;
  onPatchPoint: (patch: Partial<Pick<BranchPoint, 'label' | 'time' | 'kind'>>) => void;
  onDeletePoint: () => void;
  onAddBranch: (outcome: RollOutcome) => void;
  onPatchBranch: (outcome: RollOutcome, patch: Partial<Branch>) => void;
  onRemoveBranch: (outcome: RollOutcome) => void;
  onUploadBranch: (outcome: RollOutcome, file: File) => void;
  onSeek: (time: number) => void;
}

function BranchPointEditor({
  point, baseDuration, videoUrls, uploading,
  onPatchPoint, onDeletePoint, onAddBranch, onPatchBranch, onRemoveBranch, onUploadBranch, onSeek,
}: BranchPointEditorProps) {
  return (
    <div className="rounded-xl border border-void-700 bg-void-900/40 p-5">
      {/* Header */}
      <div className="flex flex-wrap items-end gap-4 mb-5 pb-5 border-b border-void-800">
        <div className="flex-1 min-w-[180px]">
          <label className="block text-[11px] text-gray-500 mb-1 font-medium uppercase tracking-wider">Branch point</label>
          <input
            value={point.label}
            onChange={e => onPatchPoint({ label: e.target.value })}
            className="w-full bg-void-800 border border-void-700 rounded-lg px-3 py-2 text-gray-300 focus:outline-none focus:border-arcane-500 transition-colors"
            placeholder="e.g. The fork in the road"
          />
        </div>
        <div className="w-32">
          <label className="block text-[11px] text-gray-500 mb-1 font-medium uppercase tracking-wider">Time (s)</label>
          <input
            type="number"
            min={0}
            max={baseDuration}
            step={0.5}
            value={Number(point.time.toFixed(2))}
            onChange={e => onPatchPoint({ time: Math.min(baseDuration, Math.max(0, Number(e.target.value))) })}
            className="w-full bg-void-800 border border-void-700 rounded-lg px-3 py-2 text-gray-300 focus:outline-none focus:border-arcane-500 transition-colors"
          />
        </div>
        <button
          onClick={() => onSeek(point.time)}
          className="px-3 py-2 text-xs text-gray-300 border border-void-700 hover:border-void-600 rounded-lg transition-colors"
        >
          Jump to {formatTime(point.time)}
        </button>
        <button
          onClick={onDeletePoint}
          className="px-3 py-2 text-xs text-red-500/70 hover:text-red-400 border border-red-900/40 hover:border-red-600/40 rounded-lg transition-colors"
        >
          Delete point
        </button>
      </div>

      {/* Point kind */}
      <div className="mb-4">
        <label className="block text-[11px] text-gray-500 mb-1.5 font-medium uppercase tracking-wider">Type</label>
        <div className="inline-flex rounded-lg border border-void-700 overflow-hidden">
          {([
            { k: 'branch', label: '⬦ Branch', hint: 'Roll selects a branch' },
            { k: 'roll', label: '🎲 Dice roll', hint: 'Shows a number, no branch' },
          ] as const).map(opt => (
            <button
              key={opt.k}
              onClick={() => onPatchPoint({ kind: opt.k })}
              title={opt.hint}
              className={`px-4 py-2 text-xs transition-colors ${
                point.kind === opt.k
                  ? 'bg-arcane-700 text-white'
                  : 'bg-void-800 text-gray-400 hover:text-arcane-700'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {point.kind === 'roll' ? (
        <div className="rounded-xl border border-dashed border-void-700 bg-void-900/30 p-5 text-center">
          <div className="text-2xl mb-1">🎲</div>
          <p className="text-sm text-gray-300 mb-1">Flavor dice roll</p>
          <p className="text-xs text-gray-500">
            A d20 is rolled here and the result (1–20) is shown on screen, then the story simply continues. No pass/fail, no branch.
          </p>
        </div>
      ) : (
      <>
      <p className="text-xs text-gray-500 mb-3">
        A d20 is rolled here. Each outcome can hold a branch — empty outcomes simply continue the base video.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {OUTCOME_ORDER.map(outcome => {
          const branch = point.outcomes[outcome];
          const meta = OUTCOMES[outcome];
          const slot = `${point.id}:${outcome}`;
          const branchUrl = branch?.blobKey ? videoUrls[branch.blobKey] : undefined;
          const maxCover = Math.max(0.5, baseDuration - point.time);

          return (
            <div
              key={outcome}
              className={`rounded-xl border p-4 ${meta.bgColor} ${meta.borderColor}`}
            >
              <div className="flex items-center justify-between mb-3">
                <span className={`text-xs font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                <span className="text-[10px] text-gray-500">{meta.range}</span>
              </div>

              {!branch ? (
                <button
                  onClick={() => onAddBranch(outcome)}
                  className="w-full py-2 text-xs text-gray-500 border border-dashed border-void-600 hover:border-arcane-400 hover:text-arcane-700 rounded-lg transition-colors"
                >
                  + Add branch
                </button>
              ) : (
                <div className="space-y-3">
                  {/* Video */}
                  {uploading === slot ? (
                    <div className="h-20 rounded-lg border border-void-700 bg-void-800/40 flex items-center justify-center text-xs text-gray-500">
                      Uploading…
                    </div>
                  ) : branchUrl ? (
                    <div className="rounded-lg overflow-hidden border border-void-700 bg-black">
                      <video src={branchUrl} controls className="w-full max-h-32 object-contain bg-black" />
                      <div className="px-2 py-1.5 bg-void-800/50">
                        <VideoUploader onUpload={f => onUploadBranch(outcome, f)} currentFileName="Replace" compact />
                      </div>
                    </div>
                  ) : (
                    <VideoUploader onUpload={f => onUploadBranch(outcome, f)} />
                  )}

                  {/* Type toggle */}
                  <div className="flex gap-1.5">
                    {(['addition', 'replacement'] as const).map(t => (
                      <button
                        key={t}
                        onClick={() => onPatchBranch(outcome, { type: t })}
                        className={`flex-1 py-1.5 text-[11px] rounded-lg border transition-colors capitalize ${
                          branch.type === t
                            ? 'bg-arcane-700 border-arcane-500 text-white'
                            : 'bg-void-800 border-void-700 text-gray-400 hover:text-arcane-700'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>

                  {branch.type === 'replacement' ? (
                    <div>
                      <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wider">
                        Covers base for (s) · resumes at {formatTime(Math.min(baseDuration, point.time + branch.coverDuration))}
                      </label>
                      <input
                        type="number"
                        min={0.5}
                        max={maxCover}
                        step={0.5}
                        value={Number(branch.coverDuration.toFixed(2))}
                        onChange={e =>
                          onPatchBranch(outcome, {
                            coverDuration: Math.min(maxCover, Math.max(0.5, Number(e.target.value))),
                          })
                        }
                        className="w-full bg-void-800 border border-void-700 rounded-lg px-2.5 py-1.5 text-sm text-gray-300 focus:outline-none focus:border-arcane-500"
                      />
                    </div>
                  ) : (
                    <p className="text-[10px] text-gray-500">Plays, then the base video resumes from this point.</p>
                  )}

                  <button
                    onClick={() => onRemoveBranch(outcome)}
                    className="w-full py-1.5 text-[11px] text-red-500/70 hover:text-red-400 border border-red-900/30 hover:border-red-600/40 rounded-lg transition-colors"
                  >
                    Remove branch
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>
      </>
      )}
    </div>
  );
}
