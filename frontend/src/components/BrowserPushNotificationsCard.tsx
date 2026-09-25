'use client';

import { useEffect, useState } from 'react';
import {
  getPushPermissionStatus,
  isPushSupported,
  registerPushNotifications,
} from '@/lib/pushNotifications';

export default function BrowserPushNotificationsCard() {
  const [permission, setPermission] = useState<NotificationPermission | 'unsupported'>('unsupported');
  const [isEnabling, setIsEnabling] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    setPermission(getPushPermissionStatus());
  }, []);

  const handleEnable = async () => {
    if (!isPushSupported()) {
      setPermission('unsupported');
      setStatusMessage('This browser does not support web push notifications.');
      return;
    }

    setIsEnabling(true);
    setStatusMessage(null);

    try {
      const enabled = await registerPushNotifications();
      const nextPermission = getPushPermissionStatus();
      setPermission(nextPermission);

      if (enabled) {
        setStatusMessage('Browser notifications are enabled.');
        return;
      }

      if (nextPermission === 'denied') {
        setStatusMessage('Notifications are blocked in this browser. Please enable them in your browser settings.');
        return;
      }

      setStatusMessage('Push permission was not granted. Please try again when you are ready.');
    } catch {
      setStatusMessage('Something went wrong while enabling browser notifications.');
    } finally {
      setIsEnabling(false);
    }
  };

  const isEnabled = permission === 'granted';
  const isBlocked = permission === 'denied';
  const isUnsupported = permission === 'unsupported';

  return (
    <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-3">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-slate-900">Browser notifications</p>
          <p className="text-xs text-slate-500 mt-1">
            Receive real-time updates from the platform directly in your browser.
          </p>
        </div>
        <span
          className={`inline-flex items-center rounded-full px-2 py-1 text-[10px] font-semibold uppercase tracking-wide ${
            isEnabled
              ? 'bg-emerald-100 text-emerald-700'
              : isBlocked
                ? 'bg-amber-100 text-amber-700'
                : isUnsupported
                  ? 'bg-slate-200 text-slate-600'
                  : 'bg-blue-100 text-blue-700'
          }`}
        >
          {isEnabled ? 'Enabled' : isBlocked ? 'Blocked' : isUnsupported ? 'Unsupported' : 'Not enabled'}
        </span>
      </div>

      {!isEnabled && !isUnsupported && (
        <button
          type="button"
          onClick={handleEnable}
          disabled={isEnabling}
          className="btn-primary text-sm"
        >
          {isEnabling ? 'Enabling…' : 'Enable browser notifications'}
        </button>
      )}

      {isEnabled && (
        <p className="text-sm text-emerald-700 font-medium">Browser notifications are active for this device.</p>
      )}

      {isBlocked && (
        <p className="text-sm text-amber-700 font-medium">
          Notifications are blocked. You can enable them in your browser settings and then try again.
        </p>
      )}

      {isUnsupported && (
        <p className="text-sm text-slate-600 font-medium">
          This browser does not support web push notifications.
        </p>
      )}

      {statusMessage && (
        <p className="text-sm font-medium text-slate-700">{statusMessage}</p>
      )}
    </div>
  );
}
