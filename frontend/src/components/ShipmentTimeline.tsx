'use client';

import { useState, useEffect, useCallback } from 'react';

interface Milestone {
  id: string;
  milestone: 'farm' | 'warehouse' | 'port' | 'importer';
  notes: string | null;
  stellarTxId: string | null;
  recordedBy: string;
  recordedAt: string;
}

interface ShipmentTimelineProps {
  tradeDealId: string;
  className?: string;
}

const MILESTONE_LABELS = {
  farm: 'Farm Collection',
  warehouse: 'Warehouse Storage',
  port: 'Port Shipment',
  importer: 'Importer Receipt',
};

const MILESTONE_ICONS = {
  farm: '🚜',
  warehouse: '🏭',
  port: '🚢',
  importer: '📦',
};

export const ShipmentTimeline: React.FC<ShipmentTimelineProps> = ({
  tradeDealId,
  className = '',
}) => {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchMilestones = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const token = localStorage.getItem('authToken');
      if (!token) {
        throw new Error('Authentication required');
      }

      const response = await fetch(`/api/shipments/${tradeDealId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch milestones');
      }

      const data = await response.json();
      setMilestones(data);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Failed to load milestones');
    } finally {
      setLoading(false);
    }
  }, [tradeDealId]);

  useEffect(() => {
    fetchMilestones();
  }, [fetchMilestones]);

  const getMilestoneStatus = (milestoneType: string) => {
    const milestone = milestones.find(m => m.milestone === milestoneType);
    if (milestone) return 'completed';
    
    // Check if this milestone should be next based on sequence
    const sequence = ['farm', 'warehouse', 'port', 'importer'];
    const currentIndex = sequence.findIndex(type => 
      !milestones.some(m => m.milestone === type)
    );
    
    if (currentIndex === -1) return 'completed'; // All completed
    if (sequence.indexOf(milestoneType) === currentIndex) return 'current';
    if (sequence.indexOf(milestoneType) < currentIndex) return 'completed';
    return 'pending';
  };

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (loading) {
    return (
      <div className={`animate-pulse ${className}`}>
        <div className="space-y-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="flex items-center space-x-4">
              <div className="w-8 h-8 bg-gray-200 rounded-full"></div>
              <div className="flex-1">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className={`bg-red-50 border border-red-200 rounded-lg p-4 ${className}`}>
        <p className="text-red-800 text-sm">{error}</p>
        <button
          onClick={fetchMilestones}
          className="mt-2 text-sm text-red-600 hover:text-red-800 underline"
        >
          Try again
        </button>
      </div>
    );
  }

  return (
    <div className={`space-y-6 ${className}`}>
      <h3 className="text-lg font-semibold text-gray-900">Shipment Timeline</h3>
      
      <div className="relative">
        {/* Timeline line */}
        <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200"></div>
        
        <div className="space-y-6">
          {Object.entries(MILESTONE_LABELS).map(([milestoneType, label], index) => {
            const status = getMilestoneStatus(milestoneType);
            const milestone = milestones.find(m => m.milestone === milestoneType);
            
            return (
              <div key={milestoneType} className="relative flex items-start space-x-4">
                {/* Timeline dot */}
                <div className={`
                  relative z-10 flex items-center justify-center w-8 h-8 rounded-full text-sm
                  ${status === 'completed' 
                    ? 'bg-green-500 text-white' 
                    : status === 'current'
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-200 text-gray-500'
                  }
                `}>
                  {status === 'completed' ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                  ) : (
                    MILESTONE_ICONS[milestoneType as keyof typeof MILESTONE_ICONS]
                  )}
                </div>
                
                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <h4 className={`text-sm font-medium ${
                      status === 'completed' ? 'text-gray-900' : 'text-gray-500'
                    }`}>
                      {label}
                    </h4>
                    {milestone && (
                      <span className="text-xs text-gray-500">
                        {formatDate(milestone.recordedAt)}
                      </span>
                    )}
                  </div>
                  
                  {milestone && (
                    <div className="mt-1 space-y-1">
                      {milestone.notes && (
                        <p className="text-sm text-gray-600">{milestone.notes}</p>
                      )}
                      {milestone.stellarTxId && (
                        <div className="text-xs text-gray-500">
                          <span className="font-medium">Stellar TX:</span>
                          <span className="font-mono ml-1 break-all">
                            {milestone.stellarTxId.slice(0, 16)}...
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {status === 'current' && !milestone && (
                    <p className="text-sm text-blue-600 mt-1">Next milestone</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      
      {milestones.length === 0 && (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">No milestones recorded yet</p>
          <p className="text-xs mt-1">Milestones will appear here as the shipment progresses</p>
        </div>
      )}
    </div>
  );
};