'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface ToastItem { id: string; type: ToastType; message: string; }
interface ToastCtx  { toast: (message: string, type?: ToastType) => void; }

const ToastContext = createContext<ToastCtx>({ toast: () => {} });

const CONFIG: Record<ToastType, { icon: string; bg: string; border: string; text: string }> = {
  success: { icon: '✓', bg: 'bg-emerald-600', border: 'border-emerald-500', text: 'text-white' },
  error:   { icon: '✕', bg: 'bg-red-600',     border: 'border-red-500',     text: 'text-white' },
  info:    { icon: 'ℹ', bg: 'bg-blue-600',    border: 'border-blue-500',    text: 'text-white' },
  warning: { icon: '⚠', bg: 'bg-amber-500',   border: 'border-amber-400',   text: 'text-white' },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts(prev => [...prev.slice(-4), { id, type, message }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500);
  }, []);

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div className="fixed bottom-5 right-5 z-[100] flex flex-col gap-2.5 pointer-events-none max-w-sm w-full">
        {toasts.map(t => {
          const c = CONFIG[t.type];
          return (
            <div key={t.id}
              className={`toast-enter flex items-center gap-3 px-4 py-3.5 rounded-2xl shadow-card-lg pointer-events-auto border ${c.bg} ${c.border} ${c.text}`}>
              <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold flex-shrink-0">
                {c.icon}
              </div>
              <p className="text-sm font-medium leading-snug">{t.message}</p>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
