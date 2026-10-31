'use client';

import React, { useMemo, useState } from 'react';
import {
  addComment,
  flagForModeration,
  highlightKeyInsights,
  sortThreads,
  threadComments,
  toggleThreadPin,
  upsertThread,
  voteComment,
  voteThread,
} from '@/lib/social-trading/discussions';
import type { DiscussionStore, ThreadSort } from '@/lib/social-trading/discussions';
import { sampleDiscussionStore } from '@/lib/social-trading/sample-data';
import type { ThreadScopeType } from '@/lib/social-trading/types';
import { DiscussionThreadItem } from './DiscussionThreadItem';

export interface DiscussionForumProps {
  viewerId: string;
  viewerName?: string;
  initialStore?: DiscussionStore;
}

const SORTS: Array<{ key: ThreadSort; label: string }> = [
  { key: 'hot', label: 'Hot' },
  { key: 'recent', label: 'Recent' },
  { key: 'top', label: 'Top' },
];

export const DiscussionForum: React.FC<DiscussionForumProps> = ({
  viewerId,
  viewerName = 'Demo Investor',
  initialStore,
}) => {
  const [store, setStore] = useState<DiscussionStore>(() => initialStore ?? sampleDiscussionStore());
  const [sort, setSort] = useState<ThreadSort>('hot');
  const [now] = useState(() => new Date().toISOString());
  const [showComposer, setShowComposer] = useState(false);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [scopeType, setScopeType] = useState<ThreadScopeType>('trader');
  const [scopeId, setScopeId] = useState('');
  const [composerError, setComposerError] = useState<string | null>(null);

  const threads = useMemo(
    () => sortThreads(store, { by: sort, now, includeFlagged: true }),
    [store, sort, now],
  );

  const insights = useMemo(
    () => highlightKeyInsights(store, { perThread: 1, limit: 4, threadIds: threads.map((t) => t.id) }),
    [store, threads],
  );

  const createThread = () => {
    if (title.trim().length < 8) {
      setComposerError('Thread title must be at least 8 characters.');
      return;
    }
    if (body.trim().length < 20) {
      setComposerError('Thread body must be at least 20 characters.');
      return;
    }
    setStore((prev) =>
      upsertThread(
        prev,
        {
          scopeType,
          scopeId: scopeId.trim() || viewerId,
          title: title.trim(),
          body: body.trim(),
          authorId: viewerId,
          authorName: viewerName,
        },
        { at: now, id: `thread:local:${prev.threads.length + 1}` },
      ),
    );
    setTitle('');
    setBody('');
    setScopeId('');
    setComposerError(null);
    setShowComposer(false);
  };

  return (
    <section aria-label="Community discussions" className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-slate-900 dark:text-white">Discussions</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Deal, strategy and trader forums with nested replies and community moderation.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div role="group" aria-label="Thread sort" className="flex gap-1.5 text-xs font-semibold">
            {SORTS.map((option) => (
              <button
                key={option.key}
                type="button"
                onClick={() => setSort(option.key)}
                aria-pressed={sort === option.key}
                className={`px-3 py-1.5 rounded-xl transition ${
                  sort === option.key
                    ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setShowComposer((prev) => !prev)}
            aria-expanded={showComposer}
            aria-label="Start a new discussion thread"
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white shadow-lg shadow-emerald-600/20 transition"
          >
            New thread
          </button>
        </div>
      </div>

      {showComposer && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 space-y-3">
          <h4 className="text-sm font-bold text-slate-900 dark:text-white">Create a thread</h4>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
            <div>
              <label htmlFor="thread-title" className="block font-semibold text-slate-600 dark:text-slate-300">
                Title
              </label>
              <input
                id="thread-title"
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                aria-label="Thread title"
                className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
            <div>
              <label htmlFor="thread-scope-type" className="block font-semibold text-slate-600 dark:text-slate-300">
                Scope
              </label>
              <select
                id="thread-scope-type"
                value={scopeType}
                onChange={(e) => setScopeType(e.target.value as ThreadScopeType)}
                aria-label="Thread scope type"
                className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              >
                <option value="deal">Deal</option>
                <option value="strategy">Strategy</option>
                <option value="trader">Trader</option>
              </select>
            </div>
            <div>
              <label htmlFor="thread-scope-id" className="block font-semibold text-slate-600 dark:text-slate-300">
                Scope id (optional)
              </label>
              <input
                id="thread-scope-id"
                type="text"
                value={scopeId}
                onChange={(e) => setScopeId(e.target.value)}
                aria-label="Thread scope id"
                placeholder="e.g. trader-amina"
                className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-white"
              />
            </div>
          </div>
          <div>
            <label htmlFor="thread-body" className="block text-xs font-semibold text-slate-600 dark:text-slate-300">
              Body
            </label>
            <textarea
              id="thread-body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={3}
              aria-label="Thread body"
              className="mt-1 w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs text-slate-900 dark:text-white"
            />
          </div>
          {composerError && (
            <p role="alert" className="text-[11px] font-semibold text-red-600 dark:text-red-400">
              {composerError}
            </p>
          )}
          <button
            type="button"
            onClick={createThread}
            aria-label="Publish new thread"
            className="px-3.5 py-1.5 text-xs font-bold rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 hover:opacity-90 transition"
          >
            Publish thread
          </button>
        </div>
      )}

      {insights.length > 0 && (
        <aside
          aria-label="Key insights"
          className="rounded-2xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 p-4"
        >
          <h4 className="text-xs font-black uppercase tracking-wide text-emerald-800 dark:text-emerald-300 mb-2">
            Key insights from the community
          </h4>
          <ul className="space-y-1.5 text-[11px]">
            {insights.map((insight) => (
              <li key={insight.comment.id} className="flex gap-2">
                <span className="font-black text-emerald-700 dark:text-emerald-400 shrink-0">
                  {insight.comment.upvotes}
                </span>
                <span className="text-emerald-900 dark:text-emerald-200">
                  {insight.comment.body}
                  <span className="block text-[10px] font-semibold text-emerald-700/80 dark:text-emerald-400/80">
                    — {insight.comment.authorName} in {insight.threadId}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </aside>
      )}

      <div className="space-y-4">
        {threads.map((thread) => (
          <DiscussionThreadItem
            key={thread.id}
            thread={thread}
            comments={threadComments(store, thread.id)}
            viewerId={viewerId}
            onVoteThread={(threadId) => setStore((prev) => voteThread(prev, threadId, viewerId))}
            onVoteComment={(commentId) => setStore((prev) => voteComment(prev, commentId, viewerId))}
            onReply={(threadId, replyBody, parentCommentId) =>
              setStore((prev) =>
                addComment(
                  prev,
                  {
                    threadId,
                    authorId: viewerId,
                    authorName: viewerName,
                    body: replyBody,
                    parentCommentId,
                  },
                  { at: now },
                ),
              )
            }
            onTogglePin={(threadId) => setStore((prev) => toggleThreadPin(prev, threadId))}
            onFlag={(target, reason) =>
              setStore((prev) => flagForModeration(prev, target, reason, { at: now }))
            }
          />
        ))}
        {threads.length === 0 && (
          <p className="text-sm text-slate-500 dark:text-slate-400">No threads yet — start one.</p>
        )}
      </div>
    </section>
  );
};
