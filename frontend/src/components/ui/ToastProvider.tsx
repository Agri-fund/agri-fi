'use client';

import React, { createContext, useContext, useState, useCallback, ReactNode, useRef } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  duration?: number;
}

interface ToastContextType {
  toast: (message: string, type?: ToastType, duration?: number) => string;
  dismiss: (id: string) => void;
  promise: <T>(
    promise: Promise<T>,
    msgs: { loading: string; success: string; error: string },
    opts?: { duration?: number }
  ) => Promise<T>;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const DEFAULT_DURATION = 5000;

export const ToastProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timeouts = useRef<{ [key: string]: NodeJS.Timeout }>({});

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    if (timeouts.current[id]) {
      clearTimeout(timeouts.current[id]);
      delete timeouts.current[id];
    }
  }, []);

  const toast = useCallback(
    (message: string, type: ToastType = 'info', duration: number = DEFAULT_DURATION) => {
      const id = Math.random().toString(36).substring(2, 9);
      
      setToasts((prev) => [...prev, { id, message, type, duration }]);

      if (type !== 'loading') {
        const timeout = setTimeout(() => {
          dismiss(id);
        }, duration);
        timeouts.current[id] = timeout;
      }

      return id;
    },
    [dismiss]
  );

  const promise = useCallback(
    async <T,>(
      promise: Promise<T>,
      msgs: { loading: string; success: string; error: string },
      opts?: { duration?: number }
    ): Promise<T> => {
      const id = toast(msgs.loading, 'loading');

      try {
        const result = await promise;
        setToasts((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, type: 'success', message: msgs.success } : t
          )
        );
        
        // Start timeout for success message
        const timeout = setTimeout(() => {
          dismiss(id);
        }, opts?.duration || DEFAULT_DURATION);
        timeouts.current[id] = timeout;
        
        return result;
      } catch (error) {
        setToasts((prev) =>
          prev.map((t) =>
            t.id === id ? { ...t, type: 'error', message: msgs.error } : t
          )
        );
        
        // Start timeout for error message
        const timeout = setTimeout(() => {
          dismiss(id);
        }, opts?.duration || DEFAULT_DURATION);
        timeouts.current[id] = timeout;
        
        throw error;
      }
    },
    [toast, dismiss]
  );

  return (
    <ToastContext.Provider value={{ toast, dismiss, promise }}>
      {children}
      <div
        aria-live="polite"
        aria-atomic="true"
        className="fixed bottom-5 right-5 z-[100] flex flex-col gap-3 pointer-events-none max-w-sm w-full"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`flex items-center gap-3 px-4 py-3.5 rounded-xl shadow-lg pointer-events-auto border transition-all duration-300 animate-slide-in-r ${getToastStyles(t.type)}`}
          >
            <div className="flex-shrink-0">
              {getIcon(t.type)}
            </div>
            <p className="text-sm font-medium leading-snug">{t.message}</p>
            <button
              onClick={() => dismiss(t.id)}
              className="ml-auto text-current opacity-50 hover:opacity-100 transition-opacity"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

const getToastStyles = (type: ToastType): string => {
  switch (type) {
    case 'success':
      return 'bg-emerald-600 border-emerald-500 text-white';
    case 'error':
      return 'bg-red-600 border-red-500 text-white';
    case 'warning':
      return 'bg-amber-500 border-amber-400 text-white';
    case 'loading':
      return 'bg-blue-600 border-blue-500 text-white';
    case 'info':
    default:
      return 'bg-slate-800 border-slate-700 text-white';
  }
};

const getIcon = (type: ToastType) => {
  switch (type) {
    case 'success':
      return (
        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
          ✓
        </div>
      );
    case 'error':
      return (
        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
          ✕
        </div>
      );
    case 'warning':
      return (
        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
          !
        </div>
      );
    case 'loading':
      return (
        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
      );
    case 'info':
    default:
      return (
        <div className="w-5 h-5 rounded-full bg-white/20 flex items-center justify-center text-[10px] font-bold">
          i
        </div>
      );
  }
};

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};
