import { createContext, useCallback, useContext, useMemo, useState } from "react";

type ToastVariant = "success" | "error" | "info";

type ToastItem = {
  id: string;
  title: string;
  message?: string;
  variant?: ToastVariant;
  duration?: number;
};

type ToastContextValue = {
  addToast: (toast: Omit<ToastItem, "id">) => string;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (toast: Omit<ToastItem, "id">) => {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const duration = toast.duration ?? 5000;
      setToasts((prev) => [...prev, { ...toast, id }]);
      if (duration > 0) {
        window.setTimeout(() => removeToast(id), duration);
      }
      return id;
    },
    [removeToast],
  );

  const value = useMemo(() => ({ addToast }), [addToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="fixed bottom-6 right-6 z-[40] flex flex-col gap-3">
        {toasts.map((toast) => {
          const tone =
            toast.variant === "success"
              ? "border-emerald-400/40"
              : toast.variant === "error"
                ? "border-rose-400/40"
                : "border-white/10";
          return (
            <div
              key={toast.id}
              role="status"
              className={`min-w-[260px] max-w-[340px] rounded-2xl border-2 border-blue-400/80 bg-[rgb(var(--theme-panel-strong))] px-4 py-3 shadow-[0_20px_60px_rgba(0,0,0,0.55)]`}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-white/95">{toast.title}</div>
                  {toast.message && <div className="text-xs text-white/80 mt-1">{toast.message}</div>}
                </div>
                <button
                  type="button"
                  onClick={() => removeToast(toast.id)}
                  className="h-6 w-6 rounded-full border border-white/10 bg-white/5 text-xs text-white/60 hover:bg-white/10"
                  aria-label="close"
                >
                  ×
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}
