import { normalizeStory, type Story } from '../types/story';

// Storage now lives in Cloudflare R2, fronted by the Pages Functions in
// /functions/api. Stories are JSON objects; videos and images are blobs served
// (with HTTP range support) straight from /api/blob/<key>. Reads are public;
// writes require the shared editor password.

const PW_KEY = 'fe_editor_password';

function storedPassword(): string | null {
  try { return localStorage.getItem(PW_KEY); } catch { return null; }
}

function promptPassword(): string | null {
  const pw = window.prompt('Enter the editor password to make changes:');
  if (pw) {
    try { localStorage.setItem(PW_KEY, pw); } catch { /* ignore */ }
  }
  return pw;
}

function clearPassword(): void {
  try { localStorage.removeItem(PW_KEY); } catch { /* ignore */ }
}

/** Fetch for write endpoints: attaches the editor password and re-prompts once on 401. */
async function writeFetch(url: string, init: RequestInit, body?: BodyInit, contentType?: string): Promise<Response> {
  let pw = storedPassword() ?? promptPassword();
  if (!pw) throw new Error('Editor password required.');

  const send = (password: string) => {
    const headers = new Headers(init.headers);
    headers.set('x-app-password', password);
    if (contentType) headers.set('content-type', contentType);
    return fetch(url, { ...init, headers, body });
  };

  let res = await send(pw);
  if (res.status === 401) {
    clearPassword();
    pw = promptPassword();
    if (!pw) throw new Error('Editor password required.');
    res = await send(pw);
  }
  if (!res.ok) throw new Error(`${init.method ?? 'Request'} ${url} failed: ${res.status}`);
  return res;
}

// --- Stories ---

export async function saveStory(story: Story): Promise<void> {
  await writeFetch(
    `/api/stories/${encodeURIComponent(story.id)}`,
    { method: 'PUT' },
    JSON.stringify(story),
    'application/json',
  );
}

export async function getStory(id: string): Promise<Story | undefined> {
  const res = await fetch(`/api/stories/${encodeURIComponent(id)}`);
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Failed to load story: ${res.status}`);
  return normalizeStory(await res.json());
}

export async function getAllStories(): Promise<Story[]> {
  const res = await fetch('/api/stories');
  if (!res.ok) throw new Error(`Failed to load stories: ${res.status}`);
  const raw: unknown[] = await res.json();
  return raw.map(normalizeStory).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteStory(id: string): Promise<void> {
  await writeFetch(`/api/stories/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

// --- Blobs (videos + images share one store) ---

export async function saveVideo(key: string, blob: Blob): Promise<void> {
  await writeFetch(
    `/api/blob/${encodeURIComponent(key)}`,
    { method: 'PUT' },
    blob,
    blob.type || 'application/octet-stream',
  );
}

export async function getVideoBlob(key: string): Promise<Blob | undefined> {
  const res = await fetch(`/api/blob/${encodeURIComponent(key)}`);
  if (!res.ok) return undefined;
  return res.blob();
}

export async function deleteVideo(key: string): Promise<void> {
  await writeFetch(`/api/blob/${encodeURIComponent(key)}`, { method: 'DELETE' });
}

/** A blob's URL is just its API endpoint — the browser streams it (with range support) directly. */
export function getVideoBlobUrl(key: string): Promise<string> {
  return Promise.resolve(`/api/blob/${encodeURIComponent(key)}`);
}

export const saveImage = saveVideo;
export const deleteImage = deleteVideo;
export const getImageUrl = getVideoBlobUrl;
