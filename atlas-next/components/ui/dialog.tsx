"use client";

import { X } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useT } from "@/lib/i18n";
import { cn } from "@/lib/utils";

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  'input:not([disabled]):not([type="hidden"])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]',
].join(",");

const FORM_CONTROLS = 'input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled])';

/** Open dialogs, topmost last: only the top one answers Escape and traps Tab. */
const dialogStack: symbol[] = [];
let savedPageStyle: { overflow: string; scrollbarGutter: string } | null = null;

function lockPageScroll() {
  if (dialogStack.length > 1 || savedPageStyle) return;
  const html = document.documentElement;
  savedPageStyle = { overflow: html.style.overflow, scrollbarGutter: html.style.scrollbarGutter };
  // Keep the scrollbar's space so the page behind does not jump sideways.
  if (html.scrollHeight > html.clientHeight) html.style.scrollbarGutter = "stable";
  html.style.overflow = "hidden";
}

function unlockPageScroll() {
  if (dialogStack.length > 0 || !savedPageStyle) return;
  const html = document.documentElement;
  html.style.overflow = savedPageStyle.overflow;
  html.style.scrollbarGutter = savedPageStyle.scrollbarGutter;
  savedPageStyle = null;
}

function visibleFocusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (el) => el.getClientRects().length > 0 && !el.closest("[inert]")
  );
}

function prefersReducedMotion() {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Scroll a form control into the middle of its scroll area, then focus it. */
export function revealField(id: string) {
  const el = typeof document === "undefined" ? null : document.getElementById(id);
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  el.focus({ preventScroll: true });
}

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  wide,
  size,
  layer = "base",
  scroll = "body",
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
  /** nested = sit above another dialog (Focus list-popup over voucher). */
  layer?: "base" | "nested";
  /** body = the dialog body scrolls; content = children manage their own scroll areas (sheet grids). */
  scroll?: "body" | "content";
}) {
  const t = useT();
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [edges, setEdges] = useState({ above: false, below: false });

  onCloseRef.current = onClose;
  if (!open) returnFocusRef.current = null;
  else if (returnFocusRef.current === null && typeof document !== "undefined") {
    returnFocusRef.current = (document.activeElement as HTMLElement | null) ?? document.body;
  }

  const measure = useCallback(() => {
    const body = bodyRef.current;
    if (!body) return;
    const above = body.scrollTop > 1;
    const below = body.scrollTop + body.clientHeight < body.scrollHeight - 1;
    setEdges((prev) => (prev.above === above && prev.below === below ? prev : { above, below }));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    const token = Symbol("dialog");
    const back = returnFocusRef.current;
    dialogStack.push(token);
    lockPageScroll();

    const panel = panelRef.current;
    if (panel && !panel.contains(document.activeElement)) {
      const body = bodyRef.current;
      // On touch screens focusing a field opens the keyboard over half the sheet before it is read.
      const touch = window.matchMedia("(pointer: coarse)").matches;
      const target =
        panel.querySelector<HTMLElement>("[data-autofocus]") ??
        (touch ? null : body?.querySelector<HTMLElement>(FORM_CONTROLS)) ??
        panel;
      target.focus({ preventScroll: true });
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (dialogStack[dialogStack.length - 1] !== token) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented) return;
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const items = visibleFocusables(panelRef.current);
      if (items.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (!panelRef.current.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && (active === first || active === panelRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      const index = dialogStack.indexOf(token);
      if (index >= 0) dialogStack.splice(index, 1);
      unlockPageScroll();
      if (back && back.isConnected && typeof back.focus === "function") back.focus({ preventScroll: true });
    };
  }, [open]);

  useEffect(() => {
    if (!open || scroll !== "body") return;
    const body = bodyRef.current;
    if (!body) return;
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    return () => observer.disconnect();
  }, [open, scroll, measure]);

  if (!open || typeof document === "undefined") return null;
  const resolved = size ?? (wide ? "wide" : "default");
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 flex pt-3 sm:p-4",
        layer === "nested" ? "z-[70]" : "z-50",
        resolved === "full" ? "items-stretch justify-stretch" : "items-end justify-center sm:items-center"
      )}
    >
      <div
        className="absolute inset-0 overscroll-none bg-[var(--color-umbra)]/55 animate-[fade-in_0.15s_ease-out] motion-reduce:animate-none"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn(
          "relative z-10 isolate flex w-full min-w-0 max-w-full flex-col overflow-hidden rounded-t-[var(--radius-lg)] bg-[var(--color-card)] opacity-100 shadow-[var(--shadow-pop)] outline-none animate-[slide-up_0.25s_cubic-bezier(0.16,1,0.3,1)] motion-reduce:animate-none sm:rounded-[var(--radius-lg)]",
          resolved === "full"
            ? "mx-auto my-0 h-full max-h-[calc(100dvh-0.75rem)] sm:max-h-[calc(100dvh-2rem)] sm:max-w-[min(1400px,calc(100vw-2rem))]"
            : resolved === "wide"
              ? "max-h-[92dvh] sm:max-h-[85dvh] sm:max-w-5xl"
              : "max-h-[92dvh] sm:max-h-[90dvh] sm:max-w-lg"
        )}
      >
        <div
          className={cn(
            "surface-bar relative z-[2] flex shrink-0 flex-col border-b border-[var(--color-border)] px-4 pb-4 pt-3 transition-shadow sm:px-5 sm:pt-5 no-print",
            edges.above && "shadow-[0_8px_12px_-10px_var(--color-umbra)]"
          )}
        >
          <div aria-hidden="true" className="mx-auto mb-3 h-1 w-9 rounded-full bg-[var(--color-border)] sm:hidden" />
          <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 id={titleId} className="break-words text-lg font-bold tracking-tight">{title}</h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-sm text-[var(--color-muted-foreground)]">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="-me-1.5 -mt-0.5 grid h-11 w-11 shrink-0 cursor-pointer place-items-center rounded-full text-[var(--color-muted-foreground)] transition-colors hover:bg-[var(--color-secondary)] hover:text-[var(--color-foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)]"
            aria-label={t("action.dismiss")}
          >
            <X size={18} aria-hidden="true" />
          </button>
          </div>
        </div>
        <div
          ref={bodyRef}
          onScroll={scroll === "body" ? measure : undefined}
          data-dialog-body=""
          className={cn(
            "min-h-0 flex-1 px-4 py-5 sm:px-5 print:overflow-visible print:p-0",
            !footer && "pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-5",
            scroll === "body"
              ? "overflow-y-auto overscroll-contain scroll-pb-6 scroll-pt-14"
              : "flex flex-col overflow-hidden"
          )}
        >
          {children}
        </div>
        {footer ? (
          <div
            data-dialog-footer=""
            className={cn(
              "surface-bar dialog-footer relative z-[2] flex w-full shrink-0 flex-wrap items-center justify-end gap-3 border-t border-[var(--color-border)] px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] transition-shadow sm:px-5 sm:py-4 no-print",
              edges.below && "shadow-[0_-8px_12px_-10px_var(--color-umbra)]"
            )}
          >
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body
  );
}

/** Long-form section whose heading stays pinned while its fields scroll under it. */
export function DialogSection({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className={className}>
      <h3
        id={headingId}
        className="sticky top-0 z-[1] -mx-4 mb-3 border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)] sm:-mx-5 sm:px-5"
      >
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel,
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
  const t = useT();
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <button
            type="button"
            onClick={onClose}
            data-autofocus=""
            className="h-10 rounded-[var(--radius-sm)] px-4 text-sm font-semibold hover:bg-[var(--color-secondary)] transition-colors cursor-pointer"
          >
            {t("action.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={cn(
              "h-10 rounded-[var(--radius-sm)] px-4 text-sm font-semibold text-white shadow-sm transition-all cursor-pointer disabled:opacity-50",
              destructive
                ? "bg-[var(--color-destructive)] hover:bg-[var(--color-destructive-hover)]"
                : "bg-[var(--color-primary)] hover:bg-[var(--color-primary-hover)]"
            )}
          >
            {busy ? t("state.working") : (confirmLabel ?? t("action.save"))}
          </button>
        </>
      }
    >
      <div className="text-sm text-[var(--color-foreground)]">{message}</div>
    </Dialog>
  );
}
