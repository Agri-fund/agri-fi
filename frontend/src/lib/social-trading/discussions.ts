/**
 * Community discussions (issue #1212): deal / strategy / trader forums with nested
 * replies, upvotes, moderation flags and hot/recent/top ordering.
 *
 * The store is a plain `{ threads, comments }` pair so every operation stays pure
 * and can be replayed in tests or a dry-run UI.
 */

import type {
  DiscussionComment,
  DiscussionThread,
  KeyInsight,
  ThreadScopeType,
} from './types';

export const MAX_REPLY_DEPTH = 3;
/** Comments count double a thread upvote in the hot ranking. */
export const COMMENT_VOTE_WEIGHT = 2;
/** Fixed epoch keeps the hot score deterministic across runs. */
export const HOT_EPOCH_MS = Date.UTC(2026, 0, 1, 0, 0, 0);
/** Reddit-style gravity: 45000 seconds (12.5 hours) per hot-score step. */
export const HOT_GRAVITY_SECONDS = 45_000;

export interface DiscussionStore {
  threads: DiscussionThread[];
  comments: DiscussionComment[];
}

export interface ThreadDraft {
  scopeType: ThreadScopeType;
  scopeId: string;
  title: string;
  body: string;
  authorId: string;
  authorName: string;
  tags?: string[];
}

export interface CommentDraft {
  threadId: string;
  authorId: string;
  authorName: string;
  body: string;
  parentCommentId?: string | null;
}

export function emptyStore(
  threads: DiscussionThread[] = [],
  comments: DiscussionComment[] = [],
): DiscussionStore {
  return { threads, comments };
}

export function threadPoints(thread: DiscussionThread): number {
  return thread.upvotes + COMMENT_VOTE_WEIGHT * thread.commentCount;
}

/**
 * Hot score (documented convention): sign(points) * log10(max(|points|, 1)) plus the
 * age in gravity steps since `HOT_EPOCH_MS`, so fresh activity outranks stale votes.
 */
export function hotScore(thread: DiscussionThread, nowMs: number): number {
  const points = threadPoints(thread);
  const sign = points < 0 ? -1 : 1;
  const order = Math.log10(Math.max(Math.abs(points), 1));
  const ageSeconds = (new Date(thread.createdAt).getTime() - HOT_EPOCH_MS) / 1000;
  return Math.round((sign * order + ageSeconds / HOT_GRAVITY_SECONDS) * 1000) / 1000;
}

export function createThread(
  draft: ThreadDraft,
  options: { at?: string; id?: string; pinned?: boolean } = {},
): DiscussionStore {
  const at = options.at ?? new Date().toISOString();
  const thread: DiscussionThread = {
    id: options.id ?? `thread:${slug(draft.title) || 't'}:${draft.scopeId}`,
    scopeType: draft.scopeType,
    scopeId: draft.scopeId,
    title: draft.title.trim(),
    body: draft.body.trim(),
    authorId: draft.authorId,
    authorName: draft.authorName,
    createdAt: at,
    updatedAt: at,
    lastActivityAt: at,
    tags: (draft.tags ?? []).map((t) => t.trim().toLowerCase()).filter(Boolean),
    pinned: options.pinned ?? false,
    flagged: false,
    moderationReason: null,
    upvotes: 0,
    upvotedBy: [],
    commentCount: 0,
  };
  return { ...emptyStore(), threads: [thread] };
}

export function upsertThread(
  store: DiscussionStore,
  draft: ThreadDraft,
  options: { at?: string; id?: string; pinned?: boolean } = {},
): DiscussionStore {
  const created = createThread(draft, options);
  const thread = created.threads[0];
  return {
    threads: [thread, ...store.threads.filter((t) => t.id !== thread.id)],
    comments: store.comments,
  };
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function findThread(
  store: DiscussionStore,
  threadId: string,
): DiscussionThread | undefined {
  return store.threads.find((t) => t.id === threadId);
}

export function threadComments(
  store: DiscussionStore,
  threadId: string,
  options: { sort?: 'time' | 'top' } = {},
): DiscussionComment[] {
  const comments = store.comments.filter((c) => c.threadId === threadId);
  const sort = options.sort ?? 'time';
  return [...comments].sort((a, b) => {
    if (sort === 'top' && b.upvotes !== a.upvotes) return b.upvotes - a.upvotes;
    return a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
  });
}

/**
 * Adds a comment. Replies deeper than `MAX_REPLY_DEPTH` are re-parented to the
 * deepest allowed ancestor so the rendered tree never exceeds the cap.
 */
export function addComment(
  store: DiscussionStore,
  draft: CommentDraft,
  options: { at?: string; id?: string } = {},
): DiscussionStore {
  const at = options.at ?? new Date().toISOString();
  const thread = findThread(store, draft.threadId);
  if (!thread) return store;

  let parent = draft.parentCommentId
    ? store.comments.find((c) => c.id === draft.parentCommentId) ?? null
    : null;

  if (parent && parent.threadId !== draft.threadId) parent = null;

  let depth = parent ? parent.depth + 1 : 0;
  while (parent && depth > MAX_REPLY_DEPTH) {
    parent =
      parent.parentCommentId
        ? store.comments.find((c) => c.id === parent?.parentCommentId) ?? null
        : null;
    depth = parent ? parent.depth + 1 : 0;
  }

  const comment: DiscussionComment = {
    id: options.id ?? `comment:${draft.threadId}:${slug(draft.body).slice(0, 12) || store.comments.length + 1}:${store.comments.length + 1}`,
    threadId: draft.threadId,
    authorId: draft.authorId,
    authorName: draft.authorName,
    body: draft.body.trim(),
    createdAt: at,
    parentCommentId: parent ? parent.id : null,
    depth: parent ? depth : 0,
    upvotes: 0,
    upvotedBy: [],
    flagged: false,
    moderationReason: null,
    edited: false,
  };

  return {
    threads: store.threads.map((t) =>
      t.id === draft.threadId
        ? { ...t, commentCount: t.commentCount + 1, lastActivityAt: at, updatedAt: at }
        : t,
    ),
    comments: [...store.comments, comment],
  };
}

export function editComment(
  store: DiscussionStore,
  commentId: string,
  body: string,
  options: { at?: string } = {},
): DiscussionStore {
  const at = options.at ?? new Date().toISOString();
  return {
    threads: store.threads.map((t) => {
      const comment = store.comments.find((c) => c.id === commentId);
      return comment && t.id === comment.threadId ? { ...t, lastActivityAt: at } : t;
    }),
    comments: store.comments.map((c) =>
      c.id === commentId ? { ...c, body: body.trim(), edited: true, createdAt: c.createdAt } : c,
    ),
  };
}

/** Idempotent per user: a second vote from the same id removes the first. */
export function voteThread(
  store: DiscussionStore,
  threadId: string,
  userId: string,
): DiscussionStore {
  return {
    ...store,
    threads: store.threads.map((t) => {
      if (t.id !== threadId) return t;
      const voted = t.upvotedBy.includes(userId);
      return {
        ...t,
        upvotedBy: voted ? t.upvotedBy.filter((id) => id !== userId) : [...t.upvotedBy, userId],
        upvotes: voted ? t.upvotes - 1 : t.upvotes + 1,
      };
    }),
  };
}

export function voteComment(
  store: DiscussionStore,
  commentId: string,
  userId: string,
): DiscussionStore {
  return {
    ...store,
    comments: store.comments.map((c) => {
      if (c.id !== commentId) return c;
      const voted = c.upvotedBy.includes(userId);
      return {
        ...c,
        upvotedBy: voted ? c.upvotedBy.filter((id) => id !== userId) : [...c.upvotedBy, userId],
        upvotes: voted ? c.upvotes - 1 : c.upvotes + 1,
      };
    }),
  };
}

export function toggleThreadPin(
  store: DiscussionStore,
  threadId: string,
): DiscussionStore {
  return {
    ...store,
    threads: store.threads.map((t) => (t.id === threadId ? { ...t, pinned: !t.pinned } : t)),
  };
}

export type ModerationTarget =
  | { kind: 'thread'; id: string }
  | { kind: 'comment'; id: string };

export function flagForModeration(
  store: DiscussionStore,
  target: ModerationTarget,
  reason: string,
  options: { at?: string } = {},
): DiscussionStore {
  const at = options.at ?? new Date().toISOString();
  if (target.kind === 'thread') {
    return {
      threads: store.threads.map((t) =>
        t.id === target.id
          ? { ...t, flagged: true, moderationReason: reason.trim(), updatedAt: at }
          : t,
      ),
      comments: store.comments,
    };
  }
  return {
    threads: store.threads,
    comments: store.comments.map((c) =>
      c.id === target.id
        ? { ...c, flagged: true, moderationReason: reason.trim() }
        : c,
    ),
  };
}

export function resolveModeration(
  store: DiscussionStore,
  target: ModerationTarget,
): DiscussionStore {
  if (target.kind === 'thread') {
    return {
      ...store,
      threads: store.threads.map((t) =>
        t.id === target.id ? { ...t, flagged: false, moderationReason: null } : t,
      ),
    };
  }
  return {
    ...store,
    comments: store.comments.map((c) =>
      c.id === target.id ? { ...c, flagged: false, moderationReason: null } : c,
    ),
  };
}

export type ThreadSort = 'hot' | 'recent' | 'top';

export function sortThreads(
  store: DiscussionStore,
  options: { by?: ThreadSort; now?: string; scopeType?: ThreadScopeType; scopeId?: string; includeFlagged?: boolean } = {},
): DiscussionThread[] {
  const by = options.by ?? 'hot';
  const nowMs = options.now ? new Date(options.now).getTime() : Date.now();

  let threads = store.threads;
  if (options.scopeType) threads = threads.filter((t) => t.scopeType === options.scopeType);
  if (options.scopeId) threads = threads.filter((t) => t.scopeId === options.scopeId);
  if (!options.includeFlagged) threads = threads.filter((t) => !t.flagged);

  const sorted = [...threads].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    switch (by) {
      case 'recent':
        return (
          b.lastActivityAt.localeCompare(a.lastActivityAt) || a.id.localeCompare(b.id)
        );
      case 'top':
        return (
          threadPoints(b) - threadPoints(a) ||
          a.createdAt.localeCompare(b.createdAt) ||
          a.id.localeCompare(b.id)
        );
      case 'hot':
      default:
        return (
          hotScore(b, nowMs) - hotScore(a, nowMs) || a.id.localeCompare(b.id)
        );
    }
  });

  return sorted;
}

/** Surfaces the most-upvoted comments of each thread for a TL;DR column. */
export function highlightKeyInsights(
  store: DiscussionStore,
  options: { perThread?: number; minUpvotes?: number; limit?: number; threadIds?: string[] } = {},
): KeyInsight[] {
  const perThread = options.perThread ?? 1;
  const minUpvotes = options.minUpvotes ?? 1;
  const wanted = options.threadIds ? new Set(options.threadIds) : null;

  const byThread = new Map<string, DiscussionComment[]>();
  for (const comment of store.comments) {
    if (comment.flagged) continue;
    if (comment.upvotes < minUpvotes) continue;
    if (wanted && !wanted.has(comment.threadId)) continue;
    const bucket = byThread.get(comment.threadId) ?? [];
    bucket.push(comment);
    byThread.set(comment.threadId, bucket);
  }

  const insights: KeyInsight[] = [];
  byThread.forEach((comments, threadId) => {
    const ranked = [...comments].sort(
      (a, b) => b.upvotes - a.upvotes || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    ranked.slice(0, perThread).forEach((comment) => insights.push({ threadId, comment }));
  });

  const sorted = insights.sort(
    (a, b) =>
      b.comment.upvotes - a.comment.upvotes ||
      a.comment.createdAt.localeCompare(b.comment.createdAt) ||
      a.comment.id.localeCompare(b.comment.id),
  );

  return options.limit ? sorted.slice(0, options.limit) : sorted;
}

export interface CommentNode {
  comment: DiscussionComment;
  children: CommentNode[];
}

/** Builds the reply tree; comments with a missing parent are surfaced as roots. */
export function commentTree(comments: DiscussionComment[]): CommentNode[] {
  const ordered = [...comments].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
  );
  const nodes = new Map<string, CommentNode>();
  for (const comment of ordered) nodes.set(comment.id, { comment, children: [] });

  const roots: CommentNode[] = [];
  for (const comment of ordered) {
    const node = nodes.get(comment.id);
    if (!node) continue;
    const parent = comment.parentCommentId ? nodes.get(comment.parentCommentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

/** Deepest reply level actually present in a tree, 0 when nothing is nested. */
export function treeDepth(nodes: CommentNode[], depth = 0): number {
  let deepest = depth;
  for (const node of nodes) {
    if (node.children.length === 0) continue;
    const childDepth = treeDepth(node.children, depth + 1);
    if (childDepth > deepest) deepest = childDepth;
  }
  return deepest;
}
