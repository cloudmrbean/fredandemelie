export type RollOutcome = 'critFail' | 'low' | 'high' | 'critSuccess';

export interface OutcomeMeta {
  label: string;
  range: string;
  color: string;
  bgColor: string;
  borderColor: string;
  roll: number | [number, number];
}

export const OUTCOMES: Record<RollOutcome, OutcomeMeta> = {
  critFail: {
    label: 'Critical Failure',
    range: 'Roll: 1',
    color: 'text-red-400',
    bgColor: 'bg-red-950/40',
    borderColor: 'border-red-600/50',
    roll: 1,
  },
  low: {
    label: 'Low',
    range: 'Roll: 2–10',
    color: 'text-orange-400',
    bgColor: 'bg-orange-950/40',
    borderColor: 'border-orange-600/50',
    roll: [2, 10],
  },
  high: {
    label: 'High',
    range: 'Roll: 11–19',
    color: 'text-green-400',
    bgColor: 'bg-green-950/40',
    borderColor: 'border-green-600/50',
    roll: [11, 19],
  },
  critSuccess: {
    label: 'Critical Success',
    range: 'Roll: 20',
    color: 'text-purple-400',
    bgColor: 'bg-purple-950/40',
    borderColor: 'border-purple-500/50',
    roll: 20,
  },
};

export const OUTCOME_ORDER: RollOutcome[] = ['critFail', 'low', 'high', 'critSuccess'];

export function rollD20(): number {
  return Math.floor(Math.random() * 20) + 1;
}

export function getOutcomeForRoll(roll: number): RollOutcome {
  if (roll === 1) return 'critFail';
  if (roll <= 10) return 'low';
  if (roll <= 19) return 'high';
  return 'critSuccess';
}

/** A random d20 value that falls within a given outcome's range. */
export function rollWithinOutcome(outcome: RollOutcome): number {
  const r = OUTCOMES[outcome].roll;
  if (typeof r === 'number') return r;
  const [lo, hi] = r;
  return lo + Math.floor(Math.random() * (hi - lo + 1));
}

/**
 * Picks a d20 value constrained to the outcomes that actually have a branch.
 * With a single defined outcome this always lands there (the narrative trick);
 * with several, it picks among them weighted by their natural d20 range size.
 */
export function rollForOutcomes(outcomes: RollOutcome[]): number {
  if (outcomes.length === 0) return rollD20();
  const weight = (o: RollOutcome) => {
    const r = OUTCOMES[o].roll;
    return typeof r === 'number' ? 1 : r[1] - r[0] + 1;
  };
  const total = outcomes.reduce((sum, o) => sum + weight(o), 0);
  let pick = Math.random() * total;
  for (const o of outcomes) {
    pick -= weight(o);
    if (pick < 0) return rollWithinOutcome(o);
  }
  return rollWithinOutcome(outcomes[outcomes.length - 1]);
}

export type BranchType = 'addition' | 'replacement';

export interface Branch {
  id: string;
  label: string;
  blobKey: string | null;
  type: BranchType;
  // 'replacement' only: seconds of base video covered, starting at the branch
  // point's time. Base resumes at point.time + coverDuration. Ignored for 'addition'.
  coverDuration: number;
}

// 'branch' → a d20 is rolled and its outcome selects a branch video.
// 'roll'   → a d20 is rolled purely for flavor: it shows the number (1–20)
//            and then the base video simply continues. No pass/fail, no branch.
export type PointKind = 'branch' | 'roll';

export interface BranchPoint {
  id: string;
  kind: PointKind;
  time: number; // seconds into the base video
  label: string;
  // 'roll' points only: when set (1–20), the d20 always lands on this number
  // instead of a random one. null/undefined → genuinely random.
  riggedRoll?: number | null;
  // A d20 is rolled here; for 'branch' points the outcome selects a branch.
  // An outcome with no branch means that roll simply continues the base video.
  // Ignored for 'roll' points.
  outcomes: Partial<Record<RollOutcome, Branch>>;
}

export interface Story {
  id: string;
  title: string;
  author: string; // the person whose story this is
  thumbnailKey: string | null; // image blob key, shown on the home page
  baseBlobKey: string | null;
  baseDuration: number; // seconds; 0 until video metadata loads
  branchPoints: BranchPoint[]; // kept sorted by time
  createdAt: number;
  updatedAt: number;
}

// --- Legacy migration ---

interface LegacySegment {
  id: string;
  label: string;
  blobKey: string | null;
  outcomes: Record<string, string> | null;
}

interface LegacyStory {
  id: string;
  title: string;
  rootSegmentId: string;
  segments: Record<string, LegacySegment>;
  createdAt: number;
  updatedAt: number;
}

/**
 * Upgrades a stored story to the current shape. Legacy stories (segment trees)
 * keep only their root segment's video as the new base; the old sub-tree is
 * dropped. Already-current stories pass through unchanged.
 */
export function normalizeStory(raw: unknown): Story {
  const s = raw as Partial<Story> & Partial<LegacyStory>;
  if (Array.isArray(s.branchPoints) && 'baseBlobKey' in s) {
    // Current shape — backfill fields added after this story was saved.
    const cur = raw as Story;
    return {
      ...cur,
      author: cur.author ?? '',
      thumbnailKey: cur.thumbnailKey ?? null,
      branchPoints: (cur.branchPoints ?? []).map(p => ({ ...p, kind: p.kind ?? 'branch' })),
    };
  }
  const legacy = raw as LegacyStory;
  const root = legacy.segments?.[legacy.rootSegmentId];
  return {
    id: legacy.id,
    title: legacy.title,
    author: '',
    thumbnailKey: null,
    baseBlobKey: root?.blobKey ?? null,
    baseDuration: 0,
    branchPoints: [],
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
  };
}

export function makeBranch(label: string): Branch {
  return { id: crypto.randomUUID(), label, blobKey: null, type: 'addition', coverDuration: 5 };
}

export function countBranches(story: Story): number {
  return story.branchPoints.reduce(
    (sum, p) => sum + Object.values(p.outcomes).filter(b => b).length,
    0,
  );
}

export function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
