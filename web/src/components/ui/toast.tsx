import { AlertTriangle, CheckCircle2, Info, X, XCircle } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

type ToastKind = "success" | "error" | "info" | "warning";

interface ToastItem {
  id: number;
  kind: ToastKind;
  title: string;
  message?: string;
}

interface ToastState {
  toasts: ToastItem[];
  push: (kind: ToastKind, title: string, message?: string) => void;
  dismiss: (id: number) => void;
}

let nextId = 1;

export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (kind, title, message) => {
    const id = nextId++;
    set((state) => ({ toasts: [...state.toasts, { id, kind, title, message }] }));
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  dismiss: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));

export const toast = {
  success: (title: string, message?: string) => useToasts.getState().push("success", title, message),
  error: (title: string, message?: string) => useToasts.getState().push("error", title, message),
  info: (title: string, message?: string) => useToasts.getState().push("info", title, message),
  warning: (title: string, message?: string) => useToasts.getState().push("warning", title, message),
};

const icons: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 size={18} className="text-[var(--color-success)]" />,
  error: <XCircle size={18} className="text-[var(--color-destructive)]" />,
  warning: <AlertTriangle size={18} className="text-[var(--color-warning)]" />,
  info: <Info size={18} className="text-[var(--color-info)]" />,
};

export function Toaster() {
  const { toasts, dismiss } = useToasts();
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[100] flex w-96 max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={cn(
            "pointer-events-auto flex items-start gap-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-white p-4 shadow-[var(--shadow-pop)] animate-[slide-up_0.25s_cubic-bezier(0.16,1,0.3,1)]"
          )}
        >
          <div className="mt-0.5 shrink-0">{icons[t.kind]}</div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold">{t.title}</p>
            {t.message ? (
              <p className="mt-0.5 break-words text-xs text-[var(--color-muted-foreground)]">
                {t.message}
              </p>
            ) : null}
          </div>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-1 text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)] cursor-pointer"
          >
            <X size={14} />
          </button>
        </div>
      ))}
    </div>
  );
}
