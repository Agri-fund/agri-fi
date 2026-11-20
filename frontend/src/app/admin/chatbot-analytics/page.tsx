'use client';

import React, { useState, useEffect } from 'react';

interface Analytics {
  totalConversations: number;
  emotionDistribution: Record<string, number>;
  escalationRate: number;
  averageSatisfaction: number;
  resolutionRate: number;
}

export default function ChatbotAnalyticsPage() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        setLoading(true);
        const endDate = new Date();
        const startDate = new Date(endDate);
        startDate.setDate(startDate.getDate() - days);

        const res = await fetch(
          `/api/v1/chatbot/analytics?startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`,
          {
            headers: {
              Authorization: `Bearer ${localStorage.getItem('token')}`,
            },
          }
        );

        if (!res.ok) throw new Error('Failed to load analytics');

        const data = await res.json();
        setAnalytics(data);
      } catch (err) {
        console.error('Failed to load analytics', err);
      } finally {
        setLoading(false);
      }
    };

    fetchAnalytics();
  }, [days]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading analytics...</p>
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <p className="text-red-800 font-medium">Failed to load analytics</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold text-gray-900">Chatbot Analytics</h1>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                days === d
                  ? 'bg-brand-600 text-white'
                  : 'bg-gray-200 text-gray-800 hover:bg-gray-300'
              }`}
            >
              {d} Days
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Total Conversations</p>
          <p className="text-3xl font-bold text-gray-900 mt-2">{analytics.totalConversations}</p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Average Satisfaction</p>
          <p className="text-3xl font-bold text-green-600 mt-2">
            {analytics.averageSatisfaction.toFixed(1)}/5
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Resolution Rate</p>
          <p className="text-3xl font-bold text-blue-600 mt-2">
            {Math.round(analytics.resolutionRate * 100)}%
          </p>
        </div>

        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <p className="text-sm text-gray-600 font-medium">Escalation Rate</p>
          <p className="text-3xl font-bold text-orange-600 mt-2">
            {Math.round(analytics.escalationRate * 100)}%
          </p>
        </div>
      </div>

      {/* Emotion Distribution */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-6">Emotion Distribution</h2>

        <div className="space-y-4">
          {Object.entries(analytics.emotionDistribution)
            .sort(([, a], [, b]) => b - a)
            .map(([emotion, count]) => {
              const total = analytics.totalConversations;
              const percentage = (count / total) * 100;

              return (
                <div key={emotion} className="flex items-center">
                  <div className="w-32">
                    <p className="text-sm font-medium text-gray-900 capitalize">{emotion}</p>
                  </div>

                  <div className="flex-1 bg-gray-200 rounded-full h-6 overflow-hidden">
                    <div
                      className={`h-full flex items-center justify-center text-xs font-bold text-white transition-all ${
                        emotion === 'happy'
                          ? 'bg-green-500'
                          : emotion === 'sad'
                            ? 'bg-blue-500'
                            : emotion === 'angry'
                              ? 'bg-red-500'
                              : emotion === 'anxious'
                                ? 'bg-orange-500'
                                : emotion === 'confused'
                                  ? 'bg-yellow-500'
                                  : emotion === 'frustrated'
                                    ? 'bg-red-400'
                                    : 'bg-gray-500'
                      }`}
                      style={{ width: `${percentage}%` }}
                    >
                      {percentage > 10 && `${Math.round(percentage)}%`}
                    </div>
                  </div>

                  <div className="w-24 text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {count} ({Math.round(percentage)}%)
                    </p>
                  </div>
                </div>
              );
            })}
        </div>
      </div>

      {/* Success Metrics */}
      <div className="bg-gradient-to-r from-brand-50 to-blue-50 rounded-lg border border-brand-200 p-6">
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Success Targets</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Resolution Rate Target: 70%</p>
              <span className={`px-2 py-1 rounded text-sm font-bold ${
                analytics.resolutionRate >= 0.7
                  ? 'bg-green-100 text-green-800'
                  : 'bg-orange-100 text-orange-800'
              }`}>
                {analytics.resolutionRate >= 0.7 ? '✓' : '⚠'} {Math.round(analytics.resolutionRate * 100)}%
              </span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-gray-700">Satisfaction Target: 4.5/5</p>
              <span className={`px-2 py-1 rounded text-sm font-bold ${
                analytics.averageSatisfaction >= 4.5
                  ? 'bg-green-100 text-green-800'
                  : 'bg-orange-100 text-orange-800'
              }`}>
                {analytics.averageSatisfaction >= 4.5 ? '✓' : '⚠'} {analytics.averageSatisfaction.toFixed(1)}/5
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
