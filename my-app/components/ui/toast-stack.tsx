"use client";

// Minimal, dependency-free toast — the project has no toast library, and one
// caller (UploadTab, so far) doesn't justify pulling one in. Auto-dismisses;
// click to dismiss early.

import { useCallback, useState } from "react";

export type Toast = { id: string; tone: "success" | "warning" | "danger"; title: string; detail?: string };

export function useToastStack() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((toast: Omit<Toast, "id">) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((prev) => [...prev, { ...toast, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 6000);
  }, []);

  const dismiss = useCallback((id: string) => setToasts((prev) => prev.filter((t) => t.id !== id)), []);

  return { toasts, push, dismiss };
}

const TONE_CLASSES: Record<Toast["tone"], string> = {
  success: "border-success/30 bg-success-soft text-success-foreground",
  warning: "border-warning/30 bg-warning-soft text-warning-foreground",
  danger: "border-danger/30 bg-danger-soft text-danger-foreground",
};

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: string) => void }) {
  if (toasts.length === 0) return null;
  return (
    <div className="fixed bottom-6 left-1/2 z-50 flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => onDismiss(t.id)}
          className={`rounded-lg border px-4 py-3 text-left text-[12.5px] shadow-lg ${TONE_CLASSES[t.tone]}`}
        >
          <div className="font-bold">{t.title}</div>
          {t.detail && <div className="mt-0.5 text-[11px] opacity-85">{t.detail}</div>}
        </button>
      ))}
    </div>
  );
}
