"use client";

import { createContext, useCallback, useContext, useState, ReactNode } from "react";

type Kind = "success" | "error" | "info";
type Toast = { id: number; kind: Kind; message: string };

const ToastCtx = createContext<{ push: (kind: Kind, message: string) => void } | null>(null);

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((kind: Kind, message: string) => {
    const id = Date.now() + Math.random();
    setToasts((cur) => [...cur, { id, kind, message }]);
    setTimeout(() => setToasts((cur) => cur.filter((t) => t.id !== id)), 4200);
  }, []);

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-full max-w-sm flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex items-start gap-2 rounded-xl border px-4 py-3 text-sm shadow-lg backdrop-blur ${
              t.kind === "success"
                ? "border-emerald-700 bg-emerald-950/80 text-emerald-200"
                : t.kind === "error"
                  ? "border-red-800 bg-red-950/80 text-red-200"
                  : "border-neutral-700 bg-neutral-900/90 text-neutral-200"
            }`}
          >
            <span className="mt-0.5">{t.kind === "success" ? "✓" : t.kind === "error" ? "✕" : "ℹ"}</span>
            <span className="break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
