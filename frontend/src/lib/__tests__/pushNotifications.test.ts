import {
  isPushSupported,
  getPushPermissionStatus,
  requestNotificationPermission,
  subscribeToPush,
  unsubscribeFromPush,
  registerPushNotifications,
  optInToPush,
  optOutOfPush,
  CONCRETE_PUSH_EVENT_TYPES,
} from '../pushNotifications';

describe('Push Notifications Lifecycle & Permissions', () => {
  const originalWindow = global.window;
  const originalNavigator = global.navigator;
  const originalFetch = global.fetch;

  let mockPushManager: any;
  let mockServiceWorkerRegistration: any;

  beforeEach(() => {
    jest.clearAllMocks();

    mockPushManager = {
      getSubscription: jest.fn().mockResolvedValue(null),
      subscribe: jest.fn().mockResolvedValue({
        endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-123',
        toJSON: () => ({
          endpoint: 'https://fcm.googleapis.com/fcm/send/test-endpoint-123',
          keys: {
            p256dh: 'BNcRdreALRFXTkOOUHK18PeW5pXoG1GNKFuE=',
            auth: 'tBHItDa ق='
          },
        }),
        unsubscribe: jest.fn().mockResolvedValue(true),
      }),
    };

    mockServiceWorkerRegistration = {
      pushManager: mockPushManager,
    };

    Object.defineProperty(global, 'navigator', {
      value: {
        serviceWorker: {
          register: jest.fn().mockResolvedValue(mockServiceWorkerRegistration),
          getRegistration: jest.fn().mockResolvedValue(mockServiceWorkerRegistration),
          ready: Promise.resolve(mockServiceWorkerRegistration),
        },
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      },
      writable: true,
      configurable: true,
    });

    Object.defineProperty(global, 'Notification', {
      value: {
        permission: 'default',
        requestPermission: jest.fn().mockResolvedValue('granted'),
      },
      writable: true,
      configurable: true,
    });

    (global as any).PushManager = function () {};
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true }),
    });

    // Mock localStorage
    const store: Record<string, string> = { auth_token: 'fake-jwt-token' };
    Object.defineProperty(global, 'localStorage', {
      value: {
        getItem: (k: string) => store[k] ?? null,
        setItem: (k: string, v: string) => {
          store[k] = v;
        },
        removeItem: (k: string) => {
          delete store[k];
        },
      },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    global.window = originalWindow;
    global.navigator = originalNavigator;
    global.fetch = originalFetch;
  });

  describe('Feature Support & Permission Flows', () => {
    it('detects push notification support accurately', () => {
      expect(isPushSupported()).toBe(true);
    });

    it('reports current notification permission', () => {
      expect(getPushPermissionStatus()).toBe('default');

      (global.Notification as any).permission = 'granted';
      expect(getPushPermissionStatus()).toBe('granted');

      (global.Notification as any).permission = 'denied';
      expect(getPushPermissionStatus()).toBe('denied');
    });

    it('requests user notification permission', async () => {
      const permission = await requestNotificationPermission();
      expect(permission).toBe('granted');
      expect(global.Notification.requestPermission).toHaveBeenCalledTimes(1);
    });
  });

  describe('Subscription Lifecycle with Concrete Event Types', () => {
    it('subscribes with default concrete event types and registers on server', async () => {
      const sub = await subscribeToPush('BGnZ...test-vapid-key');
      expect(sub).not.toBeNull();
      expect(mockPushManager.subscribe).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/push/subscribe'),
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('investment.confirmed'),
        }),
      );
    });

    it('supports custom concrete event types filtering', async () => {
      const customEvents = ['investment.confirmed', 'escrow.released'];
      const sub = await subscribeToPush('BGnZ...test-vapid-key', customEvents);
      expect(sub).not.toBeNull();

      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/push/subscribe'),
        expect.objectContaining({
          body: expect.stringContaining('escrow.released'),
        }),
      );
    });

    it('reuses existing subscription if already registered', async () => {
      const existingSub = {
        endpoint: 'https://existing-sub.endpoint',
        toJSON: () => ({ endpoint: 'https://existing-sub.endpoint' }),
      };
      mockPushManager.getSubscription.mockResolvedValue(existingSub);

      const sub = await subscribeToPush('BGnZ...test-vapid-key');
      expect(sub).toBe(existingSub);
      expect(mockPushManager.subscribe).not.toHaveBeenCalled();
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/push/subscribe'),
        expect.any(Object),
      );
    });

    it('handles explicit user opt-in flow via optInToPush', async () => {
      const success = await optInToPush(['investment.confirmed', 'escrow.released', 'kyc.approved']);
      expect(success).toBe(true);
    });

    it('respects opt-out via optOutOfPush and unregisters on server and browser', async () => {
      const activeSub = {
        endpoint: 'https://fcm.googleapis.com/fcm/send/active-endpoint',
        unsubscribe: jest.fn().mockResolvedValue(true),
      };
      mockPushManager.getSubscription.mockResolvedValue(activeSub);

      const result = await optOutOfPush();
      expect(result).toBe(true);
      expect(activeSub.unsubscribe).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/notifications/push/unsubscribe'),
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ endpoint: activeSub.endpoint }),
        }),
      );
    });
  });
});
