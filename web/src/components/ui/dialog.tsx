import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-[hsl(222_47%_11%/0.45)] backdrop-blur-[2px] animate-[fade-in_0.15s_ease-out]"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full rounded-[var(--radius-lg)] bg-white shadow-[var(--shadow-pop)] animate-[slide-up_0.25s_cubic-bezier(0.16,1,0.3,1)] max-h-[90vh] flex flex-col",
          wide ? "max-w-4xl" : "max-w-lg"
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-[var(--color-border)] p-5 pb-4">
          <div>
            <h2 className="text-lg font-bold tracking-tight">{title}</h2>
            {description ? (
              <p className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{description}</p>
            ) : null}
          </div>
          <button
            onClick={onClose}
            className="rounded-full p-1.5 text-[var(--color-muted-foreground)] hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)] transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>
        <div className="overflow-y-auto p-5">{children}</div>
        {footer ? (
          <div className="flex items-center justify-end gap-3 border-t border-[var(--color-border)] p-4">
            {footer}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = "Confirm",
  destructive,
  busy,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            onClick={onClose}
            className="h-10 rounded-[var(--radius-sm)] px-4 text-sm font-semibold hover:bg-[var(--color-secondary)] transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "h-10 rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-white shadow-sm transition-all cursor-pointer disabled:opacity-50",
              destructive
                ? "bg-[var(--color-destructive)] hover:bg-[hsl(0_72%_45%)]"
                : "bg-[var(--color-primary)] hover:bg-[hsl(243_75%_54%)]"
            )}
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </>
      }
    >
      <div className="text-sm text-[var(--color-foreground)]">{message}</div>
    </Dialog>
  );
}
