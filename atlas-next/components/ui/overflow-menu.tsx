"use client";

import { MoreHorizontal } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { Button } from "./button";

export interface OverflowMenuItem {
  key: string;
  label: ReactNode;
  onSelect: () => void;
  icon?: ReactNode;
  destructive?: boolean;
  disabled?: boolean;
  testId?: string;
}

const MENU_WIDTH_PX = 12 * 16; // min-w-[12rem]
const ITEM_HEIGHT_PX = 36; // min-h-9
const MENU_PAD_PX = 12;

/**
 * APG menu-button overflow (⋯) for dense table rows — extracted from the allocation
 * register's proven portaled menu, upgraded with roving keyboard focus.
 *
 * - Trigger: icon button with aria-haspopup/expanded/controls and a naming aria-label.
 * - Open: click, or ArrowDown while the trigger is focused (focus lands on item 1).
 * - Inside: ArrowUp/Down cycle, Home/End jump, Tab closes quietly, Escape closes and
 *   returns focus to the trigger. Outside press or any scroll closes (menu is anchored
 *   to the viewport via a body portal, so a detached menu must not survive scrolling).
 */
export function OverflowMenu({
  items,
  label,
  menuLabel,
  testId,
  className,
}: {
  items: OverflowMenuItem[];
  /** Trigger aria-label — must name the record ("More actions for loan 46"). */
  label: string;
  /** Accessible name of the opened menu. */
  menuLabel: string;
  testId?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  const close = useCallback((backToTrigger = false) => {
    setOpen(false);
    if (backToTrigger) triggerRef.current?.focus();
  }, []);

  const openMenu = () => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const menuH = items.length * ITEM_HEIGHT_PX + MENU_PAD_PX;
    const rtl = document.documentElement.dir === "rtl";
    const left = Math.max(8, Math.min(rtl ? r.left : r.right - MENU_WIDTH_PX, window.innerWidth - MENU_WIDTH_PX - 8));
    const roomBelow = window.innerHeight - r.bottom - 8;
    const below = roomBelow >= menuH || r.top - 8 < menuH;
    setPos(below ? { left, top: r.bottom + 4 } : { left, bottom: window.innerHeight - r.top + 4 });
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const enabledItems = () =>
      Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []).filter(
        (el) => !el.disabled
      );
    const frame = requestAnimationFrame(() => enabledItems()[0]?.focus());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
        return;
      }
      const list = enabledItems();
      if (!list.length) return;
      const i = list.indexOf(document.activeElement as HTMLButtonElement);
      if (e.key === "ArrowDown") {
        e.preventDefault();
        list[(i + 1) % list.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        list[(i - 1 + list.length) % list.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault();
        list[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault();
        list[list.length - 1]?.focus();
      } else if (e.key === "Tab") {
        close();
      }
    };
    const onDoc = (e: MouseEvent) => {
      const el = e.target as HTMLElement | null;
      if (el?.closest?.(`[data-overflow-menu="${menuId}"]`)) return;
      if (el === triggerRef.current || triggerRef.current?.contains(el)) return;
      close();
    };
    const onScroll = () => close();
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, menuId, close]);

  if (items.length === 0) return null;

  return (
    <>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="icon-sm"
        className={className}
        title={label}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-testid={testId ? `${testId}-trigger` : undefined}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            openMenu();
          }
        }}
      >
        <MoreHorizontal size={16} aria-hidden />
      </Button>
      {open && pos && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              id={menuId}
              aria-label={menuLabel}
              data-overflow-menu={menuId}
              data-testid={testId ? `${testId}-menu` : undefined}
              className="fixed z-50 min-w-[12rem] overflow-hidden rounded-[var(--radius-sm)] border border-[var(--color-border)] bg-[var(--color-card)] py-1 shadow-[var(--shadow-pop)]"
              style={{ top: pos.top, bottom: pos.bottom, left: pos.left }}
            >
              {items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  data-testid={item.testId}
                  className={cn(
                    "flex min-h-9 w-full cursor-pointer items-center gap-2 px-3 py-2 text-start text-xs font-semibold text-[var(--color-foreground)] hover:bg-[var(--color-secondary)] focus-visible:bg-[var(--color-secondary)] focus-visible:outline-none disabled:opacity-50",
                    item.destructive && "text-[var(--color-destructive)]"
                  )}
                  onClick={() => {
                    close();
                    item.onSelect();
                  }}
                >
                  {item.icon}
                  {item.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
