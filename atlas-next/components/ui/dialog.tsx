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
  size,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  /** full = near-viewport sheet for long forms (e.g. New employee) */
  size?: "default" | "wide" | "full";
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
  const resolved = size ?? (wide ? "wide" : "default");
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex p-3 sm:p-4",
        resolved === "full" ? "items-stretch justify-stretch" : "items-center justify-center"
      )}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="absolute inset-0 bg-[hsl(222_47%_11%/0.45)] backdrop-blur-[2px] animate-[fade-in_0.15s_ease-out]"
        onClick={onClose}
      />
      <div
        className={cn(
          "relative z-10 w-full rounded-[var(--radius-lg)] bg-white shadow-[var(--shadow-pop)] animate-[slide-up_0.25s_cubic-bezier(0.16,1,0.3,1)] flex flex-col",
          resolved === "full"
            ? "max-w-[min(1200px,100%)] max-h-[calc(100vh-1.5rem)] mx-auto my-0 h-full"
            : resolved === "wide"
              ? "max-w-4xl max-h-[90vh]"
              : "max-w-lg max-h-[90vh]"
        )}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 border-b border-[var(--color-border)] p-5 pb-4 no-print">
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
        <div className="min-h-0 flex-1 overflow-y-auto p-5 print:overflow-visible print:p-0">{children}</div>
        {footer ? (
          <div className="flex shrink-0 items-center justify-end gap-3 border-t border-[var(--color-border)] p-4 no-print">
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
