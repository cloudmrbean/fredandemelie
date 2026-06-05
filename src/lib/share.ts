import { normalizeStory, type BranchPoint, type Story } from '../types/story';
import { saveStory, saveVideo, getVideoBlob } from './db';
import { v4 as uuidv4 } from 'uuid';

interface ExportedVideo {
  key: string;
  type: string;
  data: string; // base64
}

interface ExportPackage {
  version: 1;
  story: Story;
  videos: ExportedVideo[];
}

export function collectBlobKeys(story: Story): string[] {
  const keys: string[] = [];
  if (story.baseBlobKey) keys.push(story.baseBlobKey);
  if (story.thumbnailKey) keys.push(story.thumbnailKey);
  for (const point of story.branchPoints) {
    for (const branch of Object.values(point.outcomes)) {
      if (branch?.blobKey) keys.push(branch.blobKey);
    }
  }
  return keys;
}

export async function exportStory(story: Story): Promise<string> {
  const keys = collectBlobKeys(story);
  const videos: ExportedVideo[] = [];

  for (const key of keys) {
    const blob = await getVideoBlob(key);
    if (!blob) continue;
    const arrayBuffer = await blob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuffer);
    let binary = '';
    for (let i = 0; i < uint8.byteLength; i++) {
      binary += String.fromCharCode(uint8[i]);
    }
    videos.push({
      key,
      type: blob.type,
      data: btoa(binary),
    });
  }

  const pkg: ExportPackage = { version: 1, story, videos };
  return JSON.stringify(pkg);
}

export async function importStory(json: string): Promise<Story> {
  const pkg: ExportPackage = JSON.parse(json);
  if (pkg.version !== 1) throw new Error('Unknown export format version');

  const sourceStory = normalizeStory(pkg.story);

  const keyRemap: Record<string, string> = {};
  for (const video of pkg.videos) {
    const newKey = uuidv4();
    keyRemap[video.key] = newKey;
    const binary = atob(video.data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    await saveVideo(newKey, new Blob([bytes], { type: video.type }));
  }

  const branchPoints: BranchPoint[] = sourceStory.branchPoints.map(point => ({
    ...point,
    id: uuidv4(),
    outcomes: Object.fromEntries(
      Object.entries(point.outcomes).map(([outcome, branch]) => [
        outcome,
        branch
          ? {
              ...branch,
              id: uuidv4(),
              blobKey: branch.blobKey ? (keyRemap[branch.blobKey] ?? branch.blobKey) : null,
            }
          : branch,
      ]),
    ),
  }));

  const story: Story = {
    ...sourceStory,
    id: uuidv4(),
    baseBlobKey: sourceStory.baseBlobKey ? (keyRemap[sourceStory.baseBlobKey] ?? sourceStory.baseBlobKey) : null,
    thumbnailKey: sourceStory.thumbnailKey ? (keyRemap[sourceStory.thumbnailKey] ?? sourceStory.thumbnailKey) : null,
    branchPoints,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  await saveStory(story);
  return story;
}

export function downloadJson(filename: string, json: string): void {
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
