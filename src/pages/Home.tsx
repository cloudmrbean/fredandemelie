import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import { getAllStories, deleteStory, saveStory, saveImage, getImageUrl, deleteImage } from '../lib/db';
import { importStory, exportStory, downloadJson } from '../lib/share';
import { useUnlocked, unlock, lock } from '../lib/auth';
import { countBranches, type Story } from '../types/story';

export default function Home() {
  const navigate = useNavigate();
  const unlocked = useUnlocked();
  const [stories, setStories] = useState<Story[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const importRef = useRef<HTMLInputElement>(null);
  const thumbInputRef = useRef<HTMLInputElement>(null);
  const thumbTargetRef = useRef<string | null>(null);

  useEffect(() => {
    getAllStories().then(s => { setStories(s); setLoading(false); });
  }, []);

  // Load thumbnail URLs
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const entries = await Promise.all(
        stories
          .filter(s => s.thumbnailKey)
          .map(async s => [s.id, await getImageUrl(s.thumbnailKey!)] as const),
      );
      if (cancelled) return;
      setThumbs(prev => {
        const map = { ...prev };
        for (const [id, url] of entries) if (url) map[id] = url;
        return map;
      });
    }
    load();
    return () => { cancelled = true; };
  }, [stories]);

  async function createNew() {
    const id = uuidv4();
    const story: Story = {
      id,
      title: 'Untitled Story',
      author: '',
      thumbnailKey: null,
      baseBlobKey: null,
      baseDuration: 0,
      branchPoints: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await saveStory(story);
    navigate(`/create/${id}`);
  }

  function pickThumbnail(storyId: string, e: React.MouseEvent) {
    e.stopPropagation();
    thumbTargetRef.current = storyId;
    thumbInputRef.current?.click();
  }

  async function handleThumbnail(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    const storyId = thumbTargetRef.current;
    e.target.value = '';
    if (!file || !storyId || !file.type.startsWith('image/')) return;

    const target = stories.find(s => s.id === storyId);
    if (!target) return;

    const key = uuidv4();
    await saveImage(key, file);
    if (target.thumbnailKey) deleteImage(target.thumbnailKey);

    if (thumbs[storyId]) URL.revokeObjectURL(thumbs[storyId]);
    const url = URL.createObjectURL(file);
    setThumbs(prev => ({ ...prev, [storyId]: url }));

    const updated: Story = { ...target, thumbnailKey: key, updatedAt: Date.now() };
    await saveStory(updated);
    setStories(prev => prev.map(s => (s.id === storyId ? updated : s)));
  }

  async function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm('Delete this story? This cannot be undone.')) return;
    await deleteStory(id);
    setStories(prev => prev.filter(s => s.id !== id));
  }

  async function handleExport(story: Story, e: React.MouseEvent) {
    e.stopPropagation();
    setExporting(story.id);
    try {
      const json = await exportStory(story);
      downloadJson(`${story.title.replace(/\s+/g, '-').toLowerCase()}.fredemelie.json`, json);
    } finally {
      setExporting(null);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      const story = await importStory(text);
      setStories(prev => [story, ...prev]);
    } catch {
      alert('Failed to import: invalid or corrupted file.');
    } finally {
      setImporting(false);
      e.target.value = '';
    }
  }

  return (
    <div className="min-h-screen bg-void-950">
      <input ref={thumbInputRef} type="file" accept="image/*" className="hidden" onChange={handleThumbnail} />

      {/* Header */}
      <header className="border-b border-void-700/70 bg-void-900/40">
        <div className="max-w-5xl mx-auto px-6 py-7 text-center relative">
          <div className="absolute top-4 right-4 sm:right-6">
            {unlocked ? (
              <button
                onClick={lock}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-gold-600/50 bg-gold-500/10 text-gold-500 hover:bg-gold-500/20 transition-colors"
                title="Lock editing"
              >
                <LockIcon open />
                Editing on
              </button>
            ) : (
              <button
                onClick={() => { void unlock(); }}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-void-600 text-gray-500 hover:text-arcane-700 hover:border-arcane-400 transition-colors"
                title="Unlock editing"
              >
                <LockIcon />
                Editor login
              </button>
            )}
          </div>
          <MonogramIcon />
          <p className="mt-2 text-[11px] uppercase tracking-[0.4em] text-gold-600">The wedding of</p>
          <h1 className="font-display text-5xl sm:text-6xl font-medium text-arcane-800 leading-none mt-1">
            Fred <span className="text-gold-500">&amp;</span> Emelie
          </h1>
          <p className="mt-3 text-sm text-gray-400 italic font-display text-lg">
            A collection of stories from the people who love them
          </p>

          {unlocked && (
            <div className="mt-5 flex items-center justify-center gap-3">
              <input ref={importRef} type="file" accept=".json" className="hidden" onChange={handleImport} />
              <button
                onClick={() => importRef.current?.click()}
                disabled={importing}
                className="px-4 py-2 rounded-full text-sm border border-void-600 hover:border-arcane-400 text-gray-400 hover:text-arcane-700 transition-colors disabled:opacity-50"
              >
                {importing ? 'Importing…' : 'Import a story'}
              </button>
              <button
                onClick={createNew}
                className="px-5 py-2 rounded-full text-sm bg-arcane-700 hover:bg-arcane-600 text-white font-medium transition-colors shadow-sm"
              >
                + Add your story
              </button>
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-10">
        {loading ? (
          <div className="flex items-center justify-center py-24 text-gray-500">Loading…</div>
        ) : stories.length === 0 ? (
          <EmptyState onCreate={createNew} unlocked={unlocked} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {stories.map(story => (
              <StoryCard
                key={story.id}
                story={story}
                thumb={thumbs[story.id]}
                branches={countBranches(story)}
                exporting={exporting === story.id}
                unlocked={unlocked}
                onPlay={() => navigate(`/play/${story.id}`)}
                onEdit={() => navigate(`/create/${story.id}`)}
                onExport={e => handleExport(story, e)}
                onDelete={e => handleDelete(story.id, e)}
                onSetThumb={e => pickThumbnail(story.id, e)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

interface StoryCardProps {
  story: Story;
  thumb?: string;
  branches: number;
  exporting: boolean;
  unlocked: boolean;
  onPlay: () => void;
  onEdit: () => void;
  onExport: (e: React.MouseEvent) => void;
  onDelete: (e: React.MouseEvent) => void;
  onSetThumb: (e: React.MouseEvent) => void;
}

function StoryCard({ story, thumb, branches, exporting, unlocked, onPlay, onEdit, onExport, onDelete, onSetThumb }: StoryCardProps) {
  return (
    <div className="group bg-void-800 border border-void-700 rounded-2xl overflow-hidden hover:border-arcane-400 hover:shadow-lg hover:shadow-arcane-200/50 transition-all duration-200 flex flex-col">
      {/* Thumbnail */}
      <div className="relative aspect-[16/10] bg-void-900 cursor-pointer overflow-hidden" onClick={onPlay}>
        {thumb ? (
          <img src={thumb} alt="" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-gold-600/70 bg-gradient-to-br from-arcane-100 to-void-900">
            <HeartIcon size={32} />
            <span className="mt-2 text-[11px] text-gray-500 tracking-wide">No photo yet</span>
          </div>
        )}
        {unlocked && (
          <button
            onClick={onSetThumb}
            className="absolute bottom-2 right-2 px-2.5 py-1 rounded-full text-[11px] bg-void-950/85 backdrop-blur-sm border border-void-600 text-gray-400 hover:text-arcane-700 hover:border-arcane-400 transition-colors opacity-0 group-hover:opacity-100"
          >
            {thumb ? 'Change photo' : '+ Add photo'}
          </button>
        )}
      </div>

      <div className="flex-1 p-5 cursor-pointer" onClick={onPlay}>
        <h2 className="font-display text-2xl font-medium text-arcane-800 leading-tight">{story.title}</h2>
        <p className="text-sm text-gray-500 mt-1 italic">
          {story.author ? `A story by ${story.author}` : 'A story for Fred & Emelie'}
        </p>
        <p className="text-xs text-gray-600 mt-3">
          {branches > 0 && <span className="mr-2">{branches} twist{branches !== 1 ? 's' : ''} of fate · </span>}
          {new Date(story.updatedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>

      <div className="border-t border-void-700 px-3 py-2 flex items-center gap-1">
        <button onClick={onPlay} className="flex-1 py-1.5 text-xs text-gray-500 hover:text-arcane-700 rounded-lg hover:bg-arcane-100 transition-colors">
          Watch
        </button>
        {unlocked && (
          <>
            <button onClick={onEdit} className="flex-1 py-1.5 text-xs text-gray-500 hover:text-arcane-700 rounded-lg hover:bg-arcane-100 transition-colors">
              Edit
            </button>
            <button onClick={onExport} disabled={exporting} className="flex-1 py-1.5 text-xs text-gray-500 hover:text-arcane-700 rounded-lg hover:bg-arcane-100 transition-colors disabled:opacity-50">
              {exporting ? '…' : 'Export'}
            </button>
            <button onClick={onDelete} className="flex-1 py-1.5 text-xs text-red-400/80 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}

function EmptyState({ onCreate, unlocked }: { onCreate: () => void; unlocked: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-24 text-center">
      <div className="mb-6 text-gold-500/70">
        <HeartIcon size={64} />
      </div>
      <h2 className="font-display text-3xl font-medium text-arcane-800 mb-2">No stories yet</h2>
      <p className="text-gray-500 mb-6 max-w-sm">
        Share a memory, a toast, or a tale of Fred &amp; Emelie — every roll of fate reveals a different version.
      </p>
      {unlocked && (
        <button
          onClick={onCreate}
          className="px-6 py-3 bg-arcane-700 hover:bg-arcane-600 text-white rounded-full font-medium transition-colors shadow-sm"
        >
          Add the first story
        </button>
      )}
    </div>
  );
}

function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="4" y="11" width="16" height="10" rx="2" />
      {open ? (
        <path strokeLinecap="round" d="M8 11V7a4 4 0 0 1 7.5-2" />
      ) : (
        <path strokeLinecap="round" d="M8 11V7a4 4 0 0 1 8 0v4" />
      )}
    </svg>
  );
}

function HeartIcon({ size = 28 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        d="M12 20.5C12 20.5 3.5 14.8 3.5 8.9C3.5 6.2 5.6 4.2 8.1 4.2C9.8 4.2 11.2 5.1 12 6.5C12.8 5.1 14.2 4.2 15.9 4.2C18.4 4.2 20.5 6.2 20.5 8.9C20.5 14.8 12 20.5 12 20.5Z"
        stroke="currentColor"
        strokeWidth="1.3"
        fill="currentColor"
        fillOpacity="0.12"
      />
    </svg>
  );
}

function MonogramIcon() {
  return (
    <svg width="46" height="46" viewBox="0 0 48 48" fill="none" className="mx-auto">
      <circle cx="19" cy="24" r="13" stroke="#c9a24b" strokeWidth="1.5" />
      <circle cx="29" cy="24" r="13" stroke="#bd5e72" strokeWidth="1.5" />
    </svg>
  );
}
