'use client';

import React, { useState } from 'react';
import { ArrowBigUp, Flag, MessageSquare, Pin } from 'lucide-react';
import { MAX_REPLY_DEPTH, commentTree } from '@/lib/social-trading/discussions';
import type { CommentNode } from '@/lib/social-trading/discussions';
import type { DiscussionComment, DiscussionThread } from '@/lib/social-trading/types';

export interface DiscussionThreadItemProps {
  thread: DiscussionThread;
  comments: DiscussionComment[];
  viewerId: string;
  onVoteThread: (threadId: string) => void;
  onVoteComment: (commentId: string) => void;
  onReply: (threadId: string, body: string, parentCommentId: string | null) => void;
  onTogglePin: (threadId: string) => void;
  onFlag: (target: { kind: 'thread' | 'comment'; id: string }, reason: string) => void;
}

export const DiscussionThreadItem: React.FC<DiscussionThreadItemProps> = ({
  thread,
  comments,
  viewerId,
  onVoteThread,
  onVoteComment,
  onReply,
  onTogglePin,
  onFlag,
}) => {
  const [replyTarget, setReplyTarget] = useState<string | null>(null);
  const [draftBody, setDraftBody] = useState('');
  const tree = commentTree(comments);

  const voted = thread.upvotedBy.includes(viewerId);

  const submitReply = (parentCommentId: string | null) => {
    if (draftBody.trim().length === 0) return;
    onReply(thread.id, draftBody.trim(), parentCommentId);
    setDraftBody('');
    setReplyTarget(null);
  };

  const renderNode = (node: CommentNode, indent: number) => {
    const { comment } = node;
    const commentVoted = comment.upvotedBy.includes(viewerId);
    const canReply = indent < MAX_REPLY_DEPTH;
    return (
      <li key={comment.id} className="space-y-2" style={{ marginLeft: indent * 16 }}>
        <div
          className={`rounded-xl border p-3 text-xs ${
            comment.flagged
              ? 'border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30'
              : 'border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40'
          }`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-bold text-slate-900 dark:text-white">
              {comment.authorName}
              <span className="ml-2 font-normal text-slate-400 dark:text-slate-500">
                {comment.createdAt.slice(0, 10)}
                {comment.edited ? ' (edited)' : ''}
              </span>
            </span>
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => onVoteComment(comment.id)}
                aria-pressed={commentVoted}
                aria-label={`Upvote comment by ${comment.authorName}`}
                className={`inline-flex items-center gap-1 rounded-lg px-2 py-0.5 text-[11px] font-bold transition ${
                  commentVoted
                    ? 'bg-emerald-600 text-white'
                    : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                <ArrowBigUp size={12} aria-hidden="true" />
                {comment.upvotes}
              </button>
              <button
                type="button"
                onClick={() => canReply && setReplyTarget(replyTarget === comment.id ? null : comment.id)}
                disabled={!canReply}
                aria-label={
                  canReply
                    ? `Reply to comment by ${comment.authorName}`
                    : `Reply depth limit of ${MAX_REPLY_DEPTH} reached on comment by ${comment.authorName}`
                }
                className="rounded-lg px-2 py-0.5 text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-40 transition"
              >
                Reply
              </button>
              <button
                type="button"
                onClick={() => onFlag({ kind: 'comment', id: comment.id }, 'Reported by a community member from the discussions UI.')}
                aria-label={`Flag comment by ${comment.authorName} for moderation`}
                className="rounded-lg px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
              >
                <Flag size={12} aria-hidden="true" />
              </button>
            </span>
          </div>
          <p className="mt-1.5 text-slate-700 dark:text-slate-300">{comment.body}</p>
          {comment.flagged && comment.moderationReason && (
            <p role="status" className="mt-1.5 text-[11px] font-semibold text-red-700 dark:text-red-400">
              Flagged for moderation: {comment.moderationReason}
            </p>
          )}
          {replyTarget === comment.id && (
            <div className="mt-2 space-y-1.5">
              <label htmlFor={`reply-${comment.id}`} className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                Your reply
              </label>
              <textarea
                id={`reply-${comment.id}`}
                value={draftBody}
                onChange={(e) => setDraftBody(e.target.value)}
                rows={2}
                aria-label={`Reply to comment by ${comment.authorName}`}
                className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => submitReply(comment.id)}
                  aria-label="Submit reply"
                  className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-bold hover:opacity-90 transition"
                >
                  Post reply
                </button>
                <button
                  type="button"
                  onClick={() => setReplyTarget(null)}
                  aria-label="Cancel reply"
                  className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[11px] font-bold hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
        {node.children.length > 0 && (
          <ul className="space-y-2">{node.children.map((child) => renderNode(child, indent + 1))}</ul>
        )}
      </li>
    );
  };

  return (
    <article
      aria-label={`Discussion thread: ${thread.title}`}
      className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm space-y-3"
    >
      <header className="flex items-start justify-between gap-3">
        <div>
          <h4 className="font-bold text-slate-900 dark:text-white text-sm">
            {thread.pinned && (
              <span className="mr-1.5 inline-flex align-middle items-center gap-0.5 text-[10px] font-black uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                <Pin size={11} aria-hidden="true" />
                Pinned
              </span>
            )}
            {thread.title}
          </h4>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
            {thread.authorName} · {thread.scopeType}: {thread.scopeId} ·{' '}
            {new Date(thread.lastActivityAt).toISOString().slice(0, 10)}
            {thread.flagged && ' · flagged for moderation'}
          </p>
        </div>
        <span className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => onVoteThread(thread.id)}
            aria-pressed={voted}
            aria-label={`Upvote thread ${thread.title}`}
            className={`inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              voted
                ? 'bg-emerald-600 text-white'
                : 'border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <ArrowBigUp size={13} aria-hidden="true" />
            {thread.upvotes}
          </button>
          <button
            type="button"
            onClick={() => onTogglePin(thread.id)}
            aria-pressed={thread.pinned}
            aria-label={thread.pinned ? `Unpin thread ${thread.title}` : `Pin thread ${thread.title}`}
            className="rounded-lg px-2 py-1 text-[11px] font-bold border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition"
          >
            <Pin size={12} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => onFlag({ kind: 'thread', id: thread.id }, 'Reported by a community member from the discussions UI.')}
            aria-label={`Flag thread ${thread.title} for moderation`}
            className="rounded-lg px-2 py-1 text-[11px] font-bold text-slate-500 dark:text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition"
          >
            <Flag size={12} aria-hidden="true" />
          </button>
        </span>
      </header>

      <p className="text-xs text-slate-600 dark:text-slate-300">{thread.body}</p>

      {thread.flagged && thread.moderationReason && (
        <p role="alert" className="text-[11px] font-semibold text-red-700 dark:text-red-400">
          Flagged for moderation: {thread.moderationReason}
        </p>
      )}

      <div className="flex gap-1.5 flex-wrap">
        {thread.tags.map((tag) => (
          <span
            key={tag}
            className="text-[10px] font-semibold rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-slate-600 dark:text-slate-300"
          >
            #{tag}
          </span>
        ))}
      </div>

      <section aria-label={`Comments on ${thread.title}`} className="space-y-2">
        <h5 className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
          <MessageSquare size={12} aria-hidden="true" />
          {thread.commentCount} comments (max reply depth {MAX_REPLY_DEPTH})
        </h5>
        <ul className="space-y-2">
          {tree.map((node) => renderNode(node, 0))}
        </ul>
        <div className="space-y-1.5">
          <label htmlFor={`new-comment-${thread.id}`} className="block text-[11px] font-semibold text-slate-600 dark:text-slate-300">
            Add a top-level comment
          </label>
          <textarea
            id={`new-comment-${thread.id}`}
            value={replyTarget === 'root' ? draftBody : ''}
            onChange={(e) => {
              setReplyTarget('root');
              setDraftBody(e.target.value);
            }}
            rows={2}
            aria-label={`Comment on thread ${thread.title}`}
            className="w-full px-2.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-white"
          />
          <button
            type="button"
            onClick={() => submitReply(null)}
            aria-label="Post comment"
            className="px-2.5 py-1 rounded-lg bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-[11px] font-bold hover:opacity-90 transition"
          >
            Post comment
          </button>
        </div>
      </section>
    </article>
  );
};
