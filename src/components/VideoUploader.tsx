import { useRef, useState, type DragEvent } from 'react';

interface Props {
  onUpload: (file: File) => void;
  currentFileName?: string;
  compact?: boolean;
}

export default function VideoUploader({ onUpload, currentFileName, compact = false }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith('video/')) return;
    onUpload(file);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  }

  if (compact) {
    return (
      <div className="flex items-center gap-3">
        <button
          onClick={() => inputRef.current?.click()}
          className="px-3 py-1.5 rounded-lg text-sm bg-void-800 border border-arcane-700/40 hover:border-arcane-500 text-arcane-700 hover:text-arcane-600 transition-colors"
        >
          {currentFileName ? 'Replace video' : 'Upload video'}
        </button>
        {currentFileName && (
          <span className="text-xs text-gray-500 truncate max-w-[160px]">{currentFileName}</span>
        )}
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          className="hidden"
          onChange={e => handleFiles(e.target.files)}
        />
      </div>
    );
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`
        cursor-pointer rounded-xl border-2 border-dashed transition-all duration-200
        flex flex-col items-center justify-center gap-3 p-8
        ${dragging
          ? 'border-arcane-500 bg-arcane-700/10'
          : 'border-void-700 hover:border-arcane-600/60 hover:bg-void-800/60 bg-void-800/30'
        }
      `}
    >
      <input
        ref={inputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={e => handleFiles(e.target.files)}
      />
      <div className="w-12 h-12 rounded-full bg-void-700 flex items-center justify-center">
        <svg className="w-6 h-6 text-arcane-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M15.75 10.5l4.72-4.72a.75.75 0 011.28.53v11.38a.75.75 0 01-1.28.53l-4.72-4.72M4.5 18.75h9a2.25 2.25 0 002.25-2.25v-9a2.25 2.25 0 00-2.25-2.25h-9A2.25 2.25 0 002.25 7.5v9a2.25 2.25 0 002.25 2.25z"
          />
        </svg>
      </div>
      {currentFileName ? (
        <>
          <p className="text-sm text-gray-400">Current: <span className="text-arcane-800 font-medium">{currentFileName}</span></p>
          <p className="text-xs text-gray-600">Click or drag to replace</p>
        </>
      ) : (
        <>
          <p className="text-sm text-gray-300 font-medium">Drop video here</p>
          <p className="text-xs text-gray-500">or click to browse · MP4, MOV, WebM</p>
        </>
      )}
    </div>
  );
}
