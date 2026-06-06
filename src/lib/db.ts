import { normalizeStory, type Story } from '../types/story';
import { getPassword, lock } from './auth';

// Storage now lives in Cloudflare R2, fronted by the Pages Functions in
// /functions/api. Stories are JSON objects; videos and images are blobs served
// (with HTTP range support) straight from /api/blob/<key>. Reads are public;
// writes require the shared editor password (see auth.ts — editing is unlocked
// from the UI before any of these run).

/** Fetch for write endpoints: attaches the editor password set at unlock time. */
async function writeFetch(url: string, init: RequestInit, body?: BodyInit, contentType?: string): Promise<Response> {
  const pw = getPassword();
  if (!pw) throw new Error('Editing is locked. Unlock editing first.');

  const headers = new Headers(init.headers);
  headers.set('x-app-password', pw);
  if (contentType) headers.set('content-type', contentType);

  const res = await fetch(url, { ...init, headers, body });
  if (res.status === 401) {
    lock(); // password no longer valid — drop back to view-only
    throw new Error('Editor password rejected.');
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
  // Ask our password-gated Function for a presigned URL, then upload the blob
  // straight to R2. This bypasses the ~100MB request-body limit on Pages
  // Functions, so large base videos upload fine.
  const res = await writeFetch(`/api/upload-url/${encodeURIComponent(key)}`, { method: 'POST' });
  const { url } = (await res.json()) as { url: string };

  const put = await fetch(url, {
    method: 'PUT',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  });
  if (!put.ok) throw new Error(`Upload to storage failed: ${put.status}`);
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
