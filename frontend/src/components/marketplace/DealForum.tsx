'use client';

import React, { useState } from 'react';
import {
  ForumThread,
  getForumThreads,
  createForumThread,
  replyToForumThread,
  upvoteForumThread,
  recordTrustInteraction,
} from '@/lib/social-proof';

interface DealForumProps {
  dealId?: string;
  dealTitle?: string;
  className?: string;
}

export function DealForum({
  dealId,
  dealTitle,
  className = '',
}: DealForumProps) {
  const [threads, setThreads] = useState<ForumThread[]>(() => getForumThreads(dealId));
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [expandedThreadId, setExpandedThreadId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // New question form state
  const [showAskModal, setShowAskModal] = useState(false);
  const [newTitle, setNewTitle] = useState('');
  const [newContent, setNewContent] = useState('');
  const [newCategory, setNewCategory] = useState<ForumThread['category']>('deal_qna');
  const [authorName, setAuthorName] = useState('');
  const [authorRole, setAuthorRole] = useState<ForumThread['authorRole']>('investor');

  // Reply form state
  const [replyContent, setReplyContent] = useState('');
  const [replyAuthor, setReplyAuthor] = useState('');

  const filteredThreads = threads.filter((t) => {
    if (activeCategory !== 'all' && t.category !== activeCategory) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchTitle = t.title.toLowerCase().includes(q);
      const matchContent = t.content.toLowerCase().includes(q);
      const matchAuthor = t.authorName.toLowerCase().includes(q);
      if (!matchTitle && !matchContent && !matchAuthor) return false;
    }
    return true;
  });

  const handleUpvote = (threadId: string) => {
    const res = upvoteForumThread(threadId);
    setThreads((prev) =>
      prev.map((t) =>
        t.id === threadId ? { ...t, upvotes: res.upvotes, userUpvoted: res.userUpvoted } : t,
      ),
    );
  };

  const handleCreateThread = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !newContent.trim() || !authorName.trim()) return;

    const created = createForumThread({
      dealId,
      dealTitle: dealTitle || 'Agri-Fi Deal',
      category: newCategory,
      title: newTitle.trim(),
      content: newContent.trim(),
      authorName: authorName.trim(),
      authorRole,
      tags: [newCategory === 'deal_qna' ? 'Deal Q&A' : newCategory === 'risk_analysis' ? 'Risk Analysis' : 'Community'],
    });

    setThreads((prev) => [created, ...prev]);
    setShowAskModal(false);
    setNewTitle('');
    setNewContent('');
  };

  const handleReplySubmit = (threadId: string, e: React.FormEvent) => {
    e.preventDefault();
    if (!replyContent.trim() || !replyAuthor.trim()) return;

    const reply = replyToForumThread(threadId, {
      authorName: replyAuthor.trim(),
      authorRole: 'investor',
      content: replyContent.trim(),
    });

    if (reply) {
      setThreads((prev) =>
        prev.map((t) =>
          t.id === threadId
            ? { ...t, replies: [...(t.replies || []), reply], repliesCount: (t.repliesCount || 0) + 1 }
            : t,
        ),
      );
      setReplyContent('');
    }
  };

  return (
    <div className={`card p-6 border border-border bg-surface ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-border">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xl">👥</span>
            <h3 className="text-lg font-bold text-foreground">Community & Deal Discussion Forum</h3>
            <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold border border-primary/20">
              {threads.length} Threads
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Ask questions directly to producers, logistics operators, risk analysts, and fellow investors.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setShowAskModal(true);
            recordTrustInteraction('forum_ask_modal_opened');
          }}
          className="btn btn-sm bg-primary text-primary-foreground hover:opacity-90 flex items-center gap-1.5 self-start sm:self-auto cursor-pointer"
        >
          <span>❓</span>
          <span>Ask Question / Start Thread</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3 border-b border-border/50 text-xs">
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {[
            { id: 'all', label: 'All Discussions' },
            { id: 'deal_qna', label: 'Deal Q&A' },
            { id: 'risk_analysis', label: 'Risk & Weather' },
            { id: 'crop_updates', label: 'Crop Telemetry' },
            { id: 'general', label: 'General / Referrals' },
          ].map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => setActiveCategory(cat.id)}
              className={`px-3 py-1 rounded-lg border font-medium whitespace-nowrap transition-colors cursor-pointer ${
                activeCategory === cat.id
                  ? 'bg-primary text-primary-foreground border-primary font-bold'
                  : 'border-border text-muted-foreground hover:bg-muted'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-56">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search discussions..."
            className="w-full pl-8 pr-3 py-1.5 rounded-lg border border-border bg-canvas text-xs text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
          />
          <span className="absolute left-2.5 top-2 text-muted-foreground text-xs">🔍</span>
        </div>
      </div>

      {/* Threads List */}
      <div className="divide-y divide-border/60 mt-2">
        {filteredThreads.length === 0 ? (
          <div className="text-center py-8 text-xs text-muted-foreground">
            No questions found. Be the first to ask the producer or analyst!
          </div>
        ) : (
          filteredThreads.map((thread) => {
            const isExpanded = expandedThreadId === thread.id;
            return (
              <div key={thread.id} className="py-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-foreground hover:text-primary transition-colors cursor-pointer" onClick={() => setExpandedThreadId(isExpanded ? null : thread.id)}>
                        {thread.title}
                      </span>
                      {thread.tags?.map((tag) => (
                        <span
                          key={tag}
                          className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {thread.content}
                    </p>

                    <div className="flex items-center gap-3 text-[11px] text-muted-foreground pt-1">
                      <span className="font-semibold text-foreground">{thread.authorName}</span>
                      <span className="px-1.5 py-0.2 rounded bg-primary/10 text-primary text-[10px] font-bold capitalize">
                        {thread.authorRole}
                      </span>
                      <span>•</span>
                      <span>
                        {new Date(thread.createdAt).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </span>
                      <span>•</span>
                      <button
                        type="button"
                        onClick={() => setExpandedThreadId(isExpanded ? null : thread.id)}
                        className="text-primary hover:underline font-medium cursor-pointer"
                      >
                        {thread.repliesCount || 0} {thread.repliesCount === 1 ? 'Reply' : 'Replies'}
                      </button>
                    </div>
                  </div>

                  {/* Upvote Button */}
                  <button
                    type="button"
                    onClick={() => handleUpvote(thread.id)}
                    className={`flex flex-col items-center justify-center min-w-10 px-2 py-1.5 rounded-xl border text-xs transition-colors cursor-pointer ${
                      thread.userUpvoted
                        ? 'bg-primary/15 text-primary border-primary/40 font-bold'
                        : 'border-border text-muted-foreground hover:bg-muted'
                    }`}
                  >
                    <span>▲</span>
                    <span className="font-bold tabular-nums">{thread.upvotes}</span>
                  </button>
                </div>

                {/* Expanded Replies & Reply Box */}
                {isExpanded && (
                  <div className="mt-3 pl-4 sm:pl-6 border-l-2 border-primary/30 space-y-3 bg-canvas/50 p-3 rounded-r-xl">
                    <h5 className="text-xs font-bold text-foreground">
                      Discussion & Verified Responses ({thread.replies?.length || 0})
                    </h5>

                    {thread.replies && thread.replies.length > 0 ? (
                      <div className="space-y-2.5">
                        {thread.replies.map((reply) => (
                          <div
                            key={reply.id}
                            className={`p-3 rounded-xl border text-xs space-y-1 ${
                              reply.isStaff
                                ? 'bg-primary/5 border-primary/30'
                                : reply.authorRole === 'farmer'
                                ? 'bg-emerald-500/5 border-emerald-500/20'
                                : 'bg-surface border-border'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px]">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-foreground">{reply.authorName}</span>
                                <span
                                  className={`text-[9px] font-bold px-1.5 py-0.2 rounded uppercase ${
                                    reply.isStaff
                                      ? 'bg-primary text-primary-foreground'
                                      : 'bg-muted text-muted-foreground'
                                  }`}
                                >
                                  {reply.authorRole}
                                </span>
                              </div>
                              <span className="text-muted-foreground text-[10px]">
                                {new Date(reply.createdAt).toLocaleDateString(undefined, {
                                  month: 'short',
                                  day: 'numeric',
                                })}
                              </span>
                            </div>
                            <p className="text-muted-foreground leading-relaxed pt-0.5">
                              {reply.content}
                            </p>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground italic">No replies yet. Be the first to answer!</p>
                    )}

                    {/* Quick Reply Form */}
                    <form
                      onSubmit={(e) => handleReplySubmit(thread.id, e)}
                      className="pt-2 space-y-2"
                    >
                      <div className="flex gap-2">
                        <input
                          type="text"
                          required
                          value={replyAuthor}
                          onChange={(e) => setReplyAuthor(e.target.value)}
                          placeholder="Your Name / Handle"
                          className="w-1/3 px-2.5 py-1.5 rounded-lg border border-border bg-canvas text-xs text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                        />
                        <input
                          type="text"
                          required
                          value={replyContent}
                          onChange={(e) => setReplyContent(e.target.value)}
                          placeholder="Write a constructive reply..."
                          className="flex-1 px-2.5 py-1.5 rounded-lg border border-border bg-canvas text-xs text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                        />
                        <button
                          type="submit"
                          className="btn btn-sm bg-primary text-primary-foreground hover:opacity-90 px-3 cursor-pointer"
                        >
                          Reply
                        </button>
                      </div>
                    </form>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Ask Question Modal */}
      {showAskModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
        >
          <div className="bg-surface border border-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-border">
              <div>
                <h3 className="text-base font-bold text-foreground">Ask a Question / Start a Discussion</h3>
                <p className="text-xs text-muted-foreground">Directly query the farmer, trader arranger, or risk analysts</p>
              </div>
              <button
                type="button"
                onClick={() => setShowAskModal(false)}
                className="text-muted-foreground hover:text-foreground text-sm p-1 rounded-lg hover:bg-muted"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateThread} className="space-y-3 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-muted-foreground font-medium mb-1">Your Name</label>
                  <input
                    type="text"
                    required
                    value={authorName}
                    onChange={(e) => setAuthorName(e.target.value)}
                    placeholder="e.g. Alex M."
                    className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-muted-foreground font-medium mb-1">Your Role</label>
                  <select
                    value={authorRole}
                    onChange={(e) => setAuthorRole(e.target.value as any)}
                    className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                  >
                    <option value="investor">Investor</option>
                    <option value="farmer">Farmer / Cooperative</option>
                    <option value="trader">Trader / Logistics</option>
                    <option value="analyst">Market Analyst</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-muted-foreground font-medium mb-1">Topic Category</label>
                <select
                  value={newCategory}
                  onChange={(e) => setNewCategory(e.target.value as any)}
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                >
                  <option value="deal_qna">Deal Q&A (Operations, Storage, Yield)</option>
                  <option value="risk_analysis">Risk Analysis & Hedging</option>
                  <option value="crop_updates">Crop Telemetry & Harvest</option>
                  <option value="general">General Platform Discussion</option>
                </select>
              </div>

              <div>
                <label className="block text-muted-foreground font-medium mb-1">Question Title</label>
                <input
                  type="text"
                  required
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="e.g. How does the escrow handle port customs clearance delays?"
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-muted-foreground font-medium mb-1">Question Details</label>
                <textarea
                  required
                  rows={4}
                  value={newContent}
                  onChange={(e) => setNewContent(e.target.value)}
                  placeholder="Provide context, references to deal documents, or specific shipment queries..."
                  className="w-full px-3 py-2 rounded-lg border border-border bg-canvas text-foreground focus:ring-1 focus:ring-primary focus:outline-none"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAskModal(false)}
                  className="btn btn-sm border border-border text-foreground hover:bg-muted"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-sm bg-primary text-primary-foreground hover:opacity-90 cursor-pointer"
                >
                  Post Question
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
export default DealForum;
