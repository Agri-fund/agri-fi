import { describe, expect, it } from 'vitest';

import {
  COMMENT_VOTE_WEIGHT,
  HOT_EPOCH_MS,
  HOT_GRAVITY_SECONDS,
  MAX_REPLY_DEPTH,
  addComment,
  commentTree,
  createThread,
  editComment,
  emptyStore,
  findThread,
  flagForModeration,
  highlightKeyInsights,
  hotScore,
  resolveModeration,
  sortThreads,
  threadComments,
  threadPoints,
  toggleThreadPin,
  treeDepth,
  upsertThread,
  voteComment,
  voteThread,
  type CommentDraft,
  type DiscussionStore,
  type ThreadDraft,
} from '../discussions';
import type { DiscussionComment, DiscussionThread } from '../types';

function threadDraft(overrides: Partial<ThreadDraft> = {}): ThreadDraft {
  return {
    scopeType: 'deal',
    scopeId: 'deal-1',
    title: 'Deal chat',
    body: 'Discuss the deal.',
    authorId: 'u-1',
    authorName: 'Ada',
    ...overrides,
  };
}

function commentDraft(overrides: Partial<CommentDraft> = {}): CommentDraft {
  return {
    threadId: 'th-1',
    authorId: 'u-2',
    authorName: 'Ben',
    body: 'A comment',
    ...overrides,
  };
}

function baseThread(overrides: Partial<DiscussionThread> = {}): DiscussionThread {
  return {
    id: 'th-1',
    scopeType: 'deal',
    scopeId: 'deal-1',
    title: 'T',
    body: 'B',
    authorId: 'u-1',
    authorName: 'Ada',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    tags: [],
    pinned: false,
    flagged: false,
    moderationReason: null,
    upvotes: 0,
    upvotedBy: [],
    commentCount: 0,
    ...overrides,
  };
}

function makeComment(overrides: Partial<DiscussionComment> = {}): DiscussionComment {
  return {
    id: 'c-1',
    threadId: 'th-1',
    authorId: 'u-2',
    authorName: 'Ben',
    body: 'Body',
    createdAt: '2026-01-02T00:00:00.000Z',
    parentCommentId: null,
    depth: 0,
    upvotes: 0,
    upvotedBy: [],
    flagged: false,
    moderationReason: null,
    edited: false,
    ...overrides,
  };
}

function storeWith(
  threads: DiscussionThread[],
  comments: DiscussionComment[],
): DiscussionStore {
  return emptyStore(threads, comments);
}

describe('module constants', () => {
  it('pins the documented hot-score epoch and tuning constants', () => {
    expect(MAX_REPLY_DEPTH).toBe(3);
    expect(COMMENT_VOTE_WEIGHT).toBe(2);
    expect(HOT_GRAVITY_SECONDS).toBe(45_000);
    expect(new Date(HOT_EPOCH_MS).toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('emptyStore', () => {
  it('defaults to empty thread and comment lists', () => {
    expect(emptyStore()).toEqual({ threads: [], comments: [] });
  });

  it('wraps the provided collections', () => {
    const thread = baseThread();
    const comment = makeComment();
    expect(emptyStore([thread], [comment])).toEqual({ threads: [thread], comments: [comment] });
  });
});

describe('createThread', () => {
  it('builds a clean deal thread with a slug id and trimmed content', () => {
    const store = createThread(
      {
        scopeType: 'deal',
        scopeId: 'deal-42',
        title: '  How risky is Deal 42?  ',
        body: '  The beans look overpriced.  ',
        authorId: 'u-1',
        authorName: 'Ada',
        tags: [' Coffee ', 'KENYA', ''],
      },
      { at: '2026-02-01T00:00:00.000Z' },
    );
    expect(store).toEqual({
      threads: [
        {
          id: 'thread:how-risky-is-deal-42:deal-42',
          scopeType: 'deal',
          scopeId: 'deal-42',
          title: 'How risky is Deal 42?',
          body: 'The beans look overpriced.',
          authorId: 'u-1',
          authorName: 'Ada',
          createdAt: '2026-02-01T00:00:00.000Z',
          updatedAt: '2026-02-01T00:00:00.000Z',
          lastActivityAt: '2026-02-01T00:00:00.000Z',
          tags: ['coffee', 'kenya'],
          pinned: false,
          flagged: false,
          moderationReason: null,
          upvotes: 0,
          upvotedBy: [],
          commentCount: 0,
        },
      ],
      comments: [],
    });
  });

  it('supports strategy scope with an explicit id and pin, and falls back to a generic slug for trader scope', () => {
    const pinned = createThread(threadDraft({ scopeType: 'strategy', scopeId: 'st-9' }), {
      at: '2026-02-01T00:00:00.000Z',
      id: 'thread-custom',
      pinned: true,
    });
    expect(pinned.threads[0].id).toBe('thread-custom');
    expect(pinned.threads[0].scopeType).toBe('strategy');
    expect(pinned.threads[0].pinned).toBe(true);

    const punctuation = createThread(
      threadDraft({ scopeType: 'trader', scopeId: 'trader-9', title: '???' }),
      { at: '2026-02-01T00:00:00.000Z' },
    );
    expect(punctuation.threads[0].id).toBe('thread:t:trader-9');
  });
});

describe('upsertThread', () => {
  it('replaces a thread with the same id at the front and keeps the comments', () => {
    const created = createThread(threadDraft({ title: 'Old title' }), {
      at: '2026-01-01T00:00:00.000Z',
      id: 'th-9',
    });
    const withComment = addComment(created, commentDraft({ threadId: 'th-9' }), {
      at: '2026-01-02T00:00:00.000Z',
      id: 'c-9',
    });
    const snapshot = JSON.parse(JSON.stringify(withComment));
    Object.freeze(withComment.threads);
    Object.freeze(withComment.comments);

    const next = upsertThread(withComment, threadDraft({ title: 'Updated title' }), {
      at: '2026-03-01T00:00:00.000Z',
      id: 'th-9',
    });

    expect(next.threads).toHaveLength(1);
    expect(next.threads[0].title).toBe('Updated title');
    expect(next.threads[0].commentCount).toBe(0);
    expect(next.comments).toBe(withComment.comments);
    expect(withComment).toEqual(snapshot);
  });

  it('prepends a brand-new thread while keeping the older ones', () => {
    const first = createThread(threadDraft(), { at: '2026-01-01T00:00:00.000Z', id: 't-old' });
    const next = upsertThread(first, threadDraft({ title: 'Fresh' }), {
      at: '2026-01-05T00:00:00.000Z',
      id: 't-new',
    });
    expect(next.threads.map((t) => t.id)).toEqual(['t-new', 't-old']);
  });
});

describe('findThread', () => {
  it('locates a thread by id and returns undefined when absent', () => {
    const store = createThread(threadDraft(), { at: '2026-01-01T00:00:00.000Z', id: 'th-1' });
    expect(findThread(store, 'th-1')?.title).toBe('Deal chat');
    expect(findThread(store, 'nope')).toBeUndefined();
  });
});

describe('threadComments', () => {
  const store = storeWith(
    [baseThread({ id: 'th-1' }), baseThread({ id: 'th-2' })],
    [
      makeComment({ id: 'c-1', threadId: 'th-1', upvotes: 3, createdAt: '2026-01-02T00:00:00.000Z' }),
      makeComment({ id: 'c-2', threadId: 'th-1', upvotes: 5, createdAt: '2026-01-03T00:00:00.000Z' }),
      makeComment({ id: 'c-3', threadId: 'th-1', upvotes: 0, createdAt: '2026-01-04T00:00:00.000Z' }),
      makeComment({ id: 'c-4', threadId: 'th-1', upvotes: 4, createdAt: '2026-01-05T00:00:00.000Z' }),
      makeComment({ id: 'c-5', threadId: 'th-1', upvotes: 4, createdAt: '2026-01-05T00:00:00.000Z' }),
      makeComment({ id: 'other', threadId: 'th-2', upvotes: 99, createdAt: '2026-01-01T00:00:00.000Z' }),
    ],
  );

  it('returns chronological order by default and only for the requested thread', () => {
    expect(threadComments(store, 'th-1').map((c) => c.id)).toEqual([
      'c-1',
      'c-2',
      'c-3',
      'c-4',
      'c-5',
    ]);
  });

  it('orders by upvotes descending for top, falling back to time then id', () => {
    expect(threadComments(store, 'th-1', { sort: 'top' }).map((c) => c.id)).toEqual([
      'c-2',
      'c-4',
      'c-5',
      'c-1',
      'c-3',
    ]);
  });

  it('returns an empty list for a thread without comments', () => {
    expect(threadComments(storeWith([baseThread({ id: 'th-3' })], []), 'th-3')).toEqual([]);
  });
});

describe('addComment', () => {
  const root = createThread(threadDraft(), { at: '2026-01-01T00:00:00.000Z', id: 'th-1' });

  function chain(): DiscussionStore {
    let store = root;
    const steps: { id: string; parent?: string; at: string }[] = [
      { id: 'c-1', at: '2026-01-02T00:00:00.000Z' },
      { id: 'c-2', parent: 'c-1', at: '2026-01-03T00:00:00.000Z' },
      { id: 'c-3', parent: 'c-2', at: '2026-01-04T00:00:00.000Z' },
      { id: 'c-4', parent: 'c-3', at: '2026-01-05T00:00:00.000Z' },
      { id: 'c-5', parent: 'c-4', at: '2026-01-06T00:00:00.000Z' },
    ];
    for (const step of steps) {
      store = addComment(
        store,
        commentDraft({ threadId: 'th-1', body: `Reply ${step.id}`, parentCommentId: step.parent }),
        { at: step.at, id: step.id },
      );
    }
    return store;
  }

  it('adds a trimmed root comment and stamps the thread activity', () => {
    const next = addComment(root, commentDraft({ body: '  Root comment  ' }), {
      at: '2026-01-02T00:00:00.000Z',
      id: 'c-1',
    });
    expect(next.comments).toEqual([
      {
        id: 'c-1',
        threadId: 'th-1',
        authorId: 'u-2',
        authorName: 'Ben',
        body: 'Root comment',
        createdAt: '2026-01-02T00:00:00.000Z',
        parentCommentId: null,
        depth: 0,
        upvotes: 0,
        upvotedBy: [],
        flagged: false,
        moderationReason: null,
        edited: false,
      },
    ]);
    expect(next.threads[0].commentCount).toBe(1);
    expect(next.threads[0].lastActivityAt).toBe('2026-01-02T00:00:00.000Z');
    expect(next.threads[0].updatedAt).toBe('2026-01-02T00:00:00.000Z');
  });

  it('increments depth for nested replies up to the cap', () => {
    const depths = chain().comments.map((c) => [c.id, c.depth, c.parentCommentId]);
    expect(depths).toEqual([
      ['c-1', 0, null],
      ['c-2', 1, 'c-1'],
      ['c-3', 2, 'c-2'],
      ['c-4', 3, 'c-3'],
      ['c-5', 3, 'c-3'],
    ]);
    expect(chain().threads[0].commentCount).toBe(5);
  });

  it('flattens a reply beyond MAX_REPLY_DEPTH onto the deepest allowed ancestor', () => {
    const five = chain();
    const c5 = five.comments.find((c) => c.id === 'c-5');
    // Replying to c-4 (depth 3) would create depth 4; the loop re-parents to c-3
    // so the new comment lands at depth 3 under c-3 instead.
    expect(c5).toMatchObject({ parentCommentId: 'c-3', depth: 3 });

    const six = addComment(
      five,
      commentDraft({ body: 'One more', parentCommentId: 'c-5' }),
      { at: '2026-01-07T00:00:00.000Z', id: 'c-6' },
    );
    const c6 = six.comments.find((c) => c.id === 'c-6');
    expect(c6).toMatchObject({ parentCommentId: 'c-3', depth: 3 });
  });

  it('treats an unknown parent as a root comment', () => {
    const next = addComment(root, commentDraft({ parentCommentId: 'ghost' }), {
      at: '2026-01-02T00:00:00.000Z',
      id: 'c-x',
    });
    expect(next.comments[0]).toMatchObject({ parentCommentId: null, depth: 0 });
  });

  it('ignores a parent from a different thread', () => {
    const twoThreads = upsertThread(root, threadDraft({ title: 'Second thread' }), {
      at: '2026-01-02T00:00:00.000Z',
      id: 'th-2',
    });
    const seeded = addComment(twoThreads, commentDraft({ threadId: 'th-1' }), {
      at: '2026-01-03T00:00:00.000Z',
      id: 'c-1',
    });
    const next = addComment(
      seeded,
      commentDraft({ threadId: 'th-2', parentCommentId: 'c-1' }),
      { at: '2026-01-04T00:00:00.000Z', id: 'c-2' },
    );
    const c2 = next.comments.find((c) => c.id === 'c-2');
    expect(c2).toMatchObject({ threadId: 'th-2', parentCommentId: null, depth: 0 });
  });

  it('returns the store untouched when the thread does not exist', () => {
    const next = addComment(root, commentDraft({ threadId: 'nope' }), { id: 'c-z' });
    expect(next).toBe(root);
  });

  it('generates deterministic ids from the body slug and ordinal when none is given', () => {
    const one = addComment(root, commentDraft({ body: 'Fresh take on origins' }), {
      at: '2026-01-02T00:00:00.000Z',
    });
    expect(one.comments[0].id).toBe('comment:th-1:fresh-take-o:1');

    const two = addComment(one, commentDraft({ body: '!!!' }), {
      at: '2026-01-03T00:00:00.000Z',
    });
    expect(two.comments[1].id).toBe('comment:th-1:2:2');
  });
});

describe('commentTree and treeDepth', () => {
  const flat = [
    makeComment({ id: 'c-1', createdAt: '2026-01-02T00:00:00.000Z' }),
    makeComment({ id: 'c-2', parentCommentId: 'c-1', createdAt: '2026-01-03T00:00:00.000Z' }),
    makeComment({ id: 'c-3', parentCommentId: 'c-2', createdAt: '2026-01-04T00:00:00.000Z' }),
    makeComment({ id: 'c-4', parentCommentId: 'c-3', createdAt: '2026-01-05T00:00:00.000Z' }),
    makeComment({ id: 'c-5', parentCommentId: 'c-3', createdAt: '2026-01-06T00:00:00.000Z' }),
  ];

  it('nests children under their parents in time order', () => {
    const roots = commentTree(flat);
    expect(roots.map((n) => n.comment.id)).toEqual(['c-1']);
    expect(roots[0].children.map((n) => n.comment.id)).toEqual(['c-2']);
    expect(roots[0].children[0].children.map((n) => n.comment.id)).toEqual(['c-3']);
    expect(roots[0].children[0].children[0].children.map((n) => n.comment.id)).toEqual([
      'c-4',
      'c-5',
    ]);
    expect(treeDepth(roots)).toBe(3);
  });

  it('surfaces comments with a missing parent as roots', () => {
    const orphans = commentTree([
      makeComment({ id: 'o-1', parentCommentId: 'ghost', createdAt: '2026-01-02T00:00:00.000Z' }),
      makeComment({ id: 'o-2', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(orphans.map((n) => n.comment.id)).toEqual(['o-2', 'o-1']);
    expect(treeDepth(orphans)).toBe(0);
  });

  it('orders root nodes chronologically', () => {
    const roots = commentTree([
      makeComment({ id: 'r-2', createdAt: '2026-01-02T00:00:00.000Z' }),
      makeComment({ id: 'r-1', createdAt: '2026-01-01T00:00:00.000Z' }),
    ]);
    expect(roots.map((n) => n.comment.id)).toEqual(['r-1', 'r-2']);
  });
});

describe('editComment', () => {
  it('trims the new body, marks the comment edited and refreshes thread activity only', () => {
    const created = createThread(threadDraft(), { at: '2026-01-01T00:00:00.000Z', id: 'th-1' });
    const withComment = addComment(created, commentDraft({ body: 'Original' }), {
      at: '2026-01-02T00:00:00.000Z',
      id: 'c-1',
    });
    const edited = editComment(withComment, 'c-1', '  Fixed wording  ', {
      at: '2026-02-01T00:00:00.000Z',
    });

    expect(edited.comments[0]).toMatchObject({
      body: 'Fixed wording',
      edited: true,
      createdAt: '2026-01-02T00:00:00.000Z',
    });
    expect(edited.threads[0].lastActivityAt).toBe('2026-02-01T00:00:00.000Z');
    expect(edited.threads[0].updatedAt).toBe('2026-01-02T00:00:00.000Z');
    expect(withComment.comments[0].body).toBe('Original');
  });
});

describe('voteThread', () => {
  const store = createThread(threadDraft(), { at: '2026-01-01T00:00:00.000Z', id: 'th-1' });

  it('adds then removes the vote for the same user (toggle per voter)', () => {
    const once = voteThread(store, 'th-1', 'u-1');
    expect(once.threads[0].upvotes).toBe(1);
    expect(once.threads[0].upvotedBy).toEqual(['u-1']);

    const twice = voteThread(once, 'th-1', 'u-2');
    expect(twice.threads[0].upvotes).toBe(2);

    const retracted = voteThread(twice, 'th-1', 'u-1');
    expect(retracted.threads[0].upvotes).toBe(1);
    expect(retracted.threads[0].upvotedBy).toEqual(['u-2']);
  });

  it('leaves other threads and the comment list alone', () => {
    const two = upsertThread(store, threadDraft({ title: 'Other' }), {
      at: '2026-01-01T00:00:00.000Z',
      id: 'th-2',
    });
    const voted = voteThread(two, 'th-1', 'u-1');
    expect(voted.threads.find((t) => t.id === 'th-2')?.upvotes).toBe(0);
    expect(voted.comments).toBe(two.comments);
  });
});

describe('voteComment', () => {
  it('toggles the per-voter upvote on a comment', () => {
    const created = createThread(threadDraft(), { at: '2026-01-01T00:00:00.000Z', id: 'th-1' });
    const withComment = addComment(created, commentDraft(), {
      at: '2026-01-02T00:00:00.000Z',
      id: 'c-1',
    });
    const up = voteComment(withComment, 'c-1', 'u-9');
    expect(up.comments[0].upvotes).toBe(1);
    expect(up.comments[0].upvotedBy).toEqual(['u-9']);
    const down = voteComment(up, 'c-1', 'u-9');
    expect(down.comments[0].upvotes).toBe(0);
    expect(down.comments[0].upvotedBy).toEqual([]);
    expect(down.threads).toBe(withComment.threads);
  });
});

describe('toggleThreadPin', () => {
  it('flips the pin state both ways and only for the target thread', () => {
    const store = storeWith([baseThread({ id: 'a' }), baseThread({ id: 'b' })], []);
    const pinned = toggleThreadPin(store, 'a');
    expect(pinned.threads.map((t) => t.pinned)).toEqual([true, false]);
    expect(toggleThreadPin(pinned, 'a').threads.map((t) => t.pinned)).toEqual([false, false]);
    expect(store.threads[0].pinned).toBe(false);
  });
});

describe('flagForModeration and resolveModeration', () => {
  const store = storeWith([baseThread({ id: 'th-1' })], [makeComment({ id: 'c-1' })]);

  it('flags a thread with a trimmed reason and stamps updatedAt', () => {
    const flagged = flagForModeration(store, { kind: 'thread', id: 'th-1' }, '  spam  ', {
      at: '2026-05-01T00:00:00.000Z',
    });
    expect(flagged.threads[0]).toMatchObject({
      flagged: true,
      moderationReason: 'spam',
      updatedAt: '2026-05-01T00:00:00.000Z',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(flagged.comments).toBe(store.comments);

    const resolved = resolveModeration(flagged, { kind: 'thread', id: 'th-1' });
    expect(resolved.threads[0].flagged).toBe(false);
    expect(resolved.threads[0].moderationReason).toBeNull();
  });

  it('flags and resolves a comment without touching the threads', () => {
    const flagged = flagForModeration(store, { kind: 'comment', id: 'c-1' }, 'abuse');
    expect(flagged.comments[0].flagged).toBe(true);
    expect(flagged.comments[0].moderationReason).toBe('abuse');
    expect(flagged.threads).toBe(store.threads);

    const resolved = resolveModeration(flagged, { kind: 'comment', id: 'c-1' });
    expect(resolved.comments[0]).toMatchObject({ flagged: false, moderationReason: null });
  });
});

describe('threadPoints and hotScore', () => {
  it('weights comments double the thread upvotes', () => {
    expect(threadPoints(baseThread({ upvotes: 5, commentCount: 3 }))).toBe(11);
    expect(threadPoints(baseThread())).toBe(0);
  });

  it('combines the log-scaled sign of points with age since the fixed epoch', () => {
    const atEpoch = baseThread({ upvotes: 10, createdAt: '2026-01-01T00:00:00.000Z' });
    // log10(10) = 1 and zero age.
    expect(hotScore(atEpoch, Date.UTC(2026, 5, 1))).toBe(1);

    const fourDays = baseThread({ upvotes: 10, createdAt: '2026-01-04T00:00:00.000Z' });
    // 1 + 259200 / 45000 = 1 + 5.76.
    expect(hotScore(fourDays, Date.UTC(2026, 5, 1))).toBe(6.76);

    const weighted = baseThread({ upvotes: 5, commentCount: 3, createdAt: '2026-01-01T00:00:00.000Z' });
    // points 11 -> log10(11) = 1.041393, zero age.
    expect(hotScore(weighted, Date.UTC(2026, 5, 1))).toBe(1.041);
  });

  it('keeps a zero-point thread at exactly one gravity step per 12.5 hours', () => {
    const half = baseThread({ createdAt: '2026-01-01T12:30:00.000Z' });
    // log10(max(0, 1)) = 0 and 45000 s of age = 1 gravity step.
    expect(hotScore(half, 0)).toBe(1);
  });

  it('applies the sign for negative points', () => {
    const downvoted = baseThread({ upvotes: -5, createdAt: '2026-01-01T00:00:00.000Z' });
    // sign -1, log10(5) = 0.698970..., zero age.
    expect(hotScore(downvoted, 0)).toBe(-0.699);
  });

  it('decays monotonically with post age and ignores the now argument', () => {
    const day1 = baseThread({ upvotes: 10, createdAt: '2026-01-01T00:00:00.000Z' });
    const day4 = baseThread({ upvotes: 10, createdAt: '2026-01-04T00:00:00.000Z' });
    const day10 = baseThread({ upvotes: 10, createdAt: '2026-01-11T00:00:00.000Z' });
    expect(hotScore(day1, 0)).toBeLessThan(hotScore(day4, 0));
    expect(hotScore(day4, 0)).toBeLessThan(hotScore(day10, 0));
    // 10 days = 864000 s / 45000 = 19.2 steps on top of the order term of 1.
    expect(hotScore(day10, 0)).toBe(20.2);
    // Determinism: the epoch is fixed, so `nowMs` never enters the score.
    expect(hotScore(day4, Date.UTC(2026, 0, 4))).toBe(hotScore(day4, Date.UTC(2030, 0, 1)));
  });
});

describe('sortThreads', () => {
  const plain = storeWith(
    [
      baseThread({
        id: 't-top',
        scopeId: 'deal-1',
        upvotes: 7,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
      baseThread({
        id: 't-mid',
        scopeId: 'deal-1',
        upvotes: 1,
        commentCount: 3,
        createdAt: '2026-01-02T00:00:00.000Z',
        lastActivityAt: '2026-01-05T00:00:00.000Z',
      }),
      baseThread({
        id: 't-low',
        scopeType: 'strategy',
        scopeId: 'st-1',
        upvotes: 5,
        createdAt: '2026-01-03T00:00:00.000Z',
        lastActivityAt: '2026-01-03T00:00:00.000Z',
      }),
      baseThread({
        id: 't-flag',
        upvotes: 100,
        flagged: true,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    ],
    [],
  );

  it('ranks by points for top, breaking ties by age, and hides flagged threads by default', () => {
    // t-top and t-mid both have 7 points; t-top is older so it wins the tie.
    expect(sortThreads(plain, { by: 'top' }).map((t) => t.id)).toEqual([
      't-top',
      't-mid',
      't-low',
    ]);
    expect(
      sortThreads(plain, { by: 'top', includeFlagged: true }).map((t) => t.id),
    ).toEqual(['t-flag', 't-top', 't-mid', 't-low']);
  });

  it('ranks by most recent activity for recent', () => {
    expect(sortThreads(plain, { by: 'recent' }).map((t) => t.id)).toEqual([
      't-mid',
      't-low',
      't-top',
    ]);
  });

  it('puts pinned threads first regardless of ranking', () => {
    const pinnedStore = toggleThreadPin(plain, 't-low');
    expect(sortThreads(pinnedStore, { by: 'top' }).map((t) => t.id)).toEqual([
      't-low',
      't-top',
      't-mid',
    ]);
  });

  it('filters by scope type and scope id', () => {
    expect(sortThreads(plain, { by: 'top', scopeType: 'strategy' }).map((t) => t.id)).toEqual([
      't-low',
    ]);
    expect(
      sortThreads(plain, { by: 'top', scopeType: 'deal', scopeId: 'deal-1' }).map((t) => t.id),
    ).toEqual(['t-top', 't-mid']);
  });

  it('ranks hot by freshness-weighted points and breaks ties by id', () => {
    const hot = storeWith(
      [
        baseThread({ id: 't-hot', upvotes: 10, createdAt: '2026-01-02T00:00:00.000Z' }),
        baseThread({ id: 't-cool', upvotes: 99, createdAt: '2026-01-01T00:00:00.000Z' }),
      ],
      [],
    );
    // t-hot: log10(10) + 86400/45000 = 2.92 beats t-cool: log10(99) = 1.996.
    expect(hotScore(hot.threads[0], 0)).toBe(2.92);
    expect(hotScore(hot.threads[1], 0)).toBe(1.996);
    expect(sortThreads(hot, { now: '2026-02-01T00:00:00.000Z' }).map((t) => t.id)).toEqual([
      't-hot',
      't-cool',
    ]);

    const tied = storeWith(
      [
        baseThread({ id: 'b-hot', upvotes: 10, createdAt: '2026-01-02T00:00:00.000Z' }),
        baseThread({ id: 'a-hot', upvotes: 10, createdAt: '2026-01-02T00:00:00.000Z' }),
      ],
      [],
    );
    expect(sortThreads(tied, { now: '2026-02-01T00:00:00.000Z' }).map((t) => t.id)).toEqual([
      'a-hot',
      'b-hot',
    ]);
  });

  it('does not mutate the source store', () => {
    const snapshot = JSON.parse(JSON.stringify(plain));
    sortThreads(plain, { by: 'top' });
    expect(plain).toEqual(snapshot);
  });
});

describe('highlightKeyInsights', () => {
  const store = storeWith(
    [baseThread({ id: 'th-1' }), baseThread({ id: 'th-2', scopeId: 'deal-2' })],
    [
      makeComment({ id: 'c-a', threadId: 'th-1', upvotes: 5, createdAt: '2026-01-01T00:00:00.000Z' }),
      makeComment({ id: 'c-b', threadId: 'th-1', upvotes: 3, createdAt: '2026-01-02T00:00:00.000Z' }),
      makeComment({ id: 'c-c', threadId: 'th-1', upvotes: 3, createdAt: '2026-01-03T00:00:00.000Z' }),
      makeComment({
        id: 'c-d',
        threadId: 'th-2',
        upvotes: 8,
        createdAt: '2026-01-02T00:00:00.000Z',
        flagged: true,
      }),
      makeComment({ id: 'c-e', threadId: 'th-2', upvotes: 1, createdAt: '2026-01-04T00:00:00.000Z' }),
    ],
  );

  function pairs(insights: { threadId: string; comment: DiscussionComment }[]) {
    return insights.map((i) => [i.threadId, i.comment.id]);
  }

  it('takes the single best non-flagged comment per thread by default', () => {
    // c-d is flagged (skipped despite 8 upvotes); minUpvotes defaults to 1.
    expect(pairs(highlightKeyInsights(store))).toEqual([
      ['th-1', 'c-a'],
      ['th-2', 'c-e'],
    ]);
  });

  it('respects the perThread cap', () => {
    expect(pairs(highlightKeyInsights(store, { perThread: 2 }))).toEqual([
      ['th-1', 'c-a'],
      ['th-1', 'c-b'],
      ['th-2', 'c-e'],
    ]);
  });

  it('drops comments below minUpvotes', () => {
    expect(pairs(highlightKeyInsights(store, { perThread: 2, minUpvotes: 2 }))).toEqual([
      ['th-1', 'c-a'],
      ['th-1', 'c-b'],
    ]);
  });

  it('restricts to the requested thread ids', () => {
    expect(pairs(highlightKeyInsights(store, { threadIds: ['th-2'] }))).toEqual([
      ['th-2', 'c-e'],
    ]);
  });

  it('applies the limit after the global ranking', () => {
    expect(pairs(highlightKeyInsights(store, { perThread: 2, limit: 1 }))).toEqual([
      ['th-1', 'c-a'],
    ]);
  });

  it('orders inside a thread by upvotes then time then id, and never surfaces flagged comments', () => {
    expect(pairs(highlightKeyInsights(store, { perThread: 5, minUpvotes: 0 }))).toEqual([
      ['th-1', 'c-a'],
      ['th-1', 'c-b'],
      ['th-1', 'c-c'],
      ['th-2', 'c-e'],
    ]);
  });
});
