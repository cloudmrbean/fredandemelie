import { openDB, type IDBPDatabase } from 'idb';
import { normalizeStory, type Story } from '../types/story';

const DB_NAME = 'branch20';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('stories')) {
          db.createObjectStore('stories', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('videos')) {
          db.createObjectStore('videos');
        }
      },
    });
  }
  return dbPromise;
}

export async function saveStory(story: Story): Promise<void> {
  const db = await getDB();
  await db.put('stories', story);
}

export async function getStory(id: string): Promise<Story | undefined> {
  const db = await getDB();
  const raw = await db.get('stories', id);
  return raw ? normalizeStory(raw) : undefined;
}

export async function getAllStories(): Promise<Story[]> {
  const db = await getDB();
  const stories: unknown[] = await db.getAll('stories');
  return stories.map(normalizeStory).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function deleteStory(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('stories', id);
}

export async function saveVideo(key: string, blob: Blob): Promise<void> {
  const db = await getDB();
  await db.put('videos', blob, key);
}

export async function getVideoBlob(key: string): Promise<Blob | undefined> {
  const db = await getDB();
  return db.get('videos', key);
}

export async function deleteVideo(key: string): Promise<void> {
  const db = await getDB();
  await db.delete('videos', key);
}

export async function getVideoBlobUrl(key: string): Promise<string | null> {
  const blob = await getVideoBlob(key);
  if (!blob) return null;
  return URL.createObjectURL(blob);
}

// Thumbnails (and any image blobs) live in the same blob store as videos.
export const saveImage = saveVideo;
export const deleteImage = deleteVideo;
export const getImageUrl = getVideoBlobUrl;

export async function getAllVideoKeys(): Promise<string[]> {
  const db = await getDB();
  const keys = await db.getAllKeys('videos');
  return keys as string[];
}

export async function deleteOrphanVideos(usedKeys: Set<string>): Promise<void> {
  const db = await getDB();
  const allKeys = await db.getAllKeys('videos') as string[];
  const tx = db.transaction('videos', 'readwrite');
  await Promise.all(
    allKeys.filter(k => !usedKeys.has(k)).map(k => tx.store.delete(k)),
  );
  await tx.done;
}
