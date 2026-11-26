import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/* Semantic badge roles: tinted bg + emphasis text + family ring.
   All text/bg pairs verified ≥4.5:1 (see tests/design-system-contract.test.mjs). */
const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--color-primary-muted)] text-[var(--color-primary-emphasis)] ring-[var(--color-primary-ring)]",
        secondary: "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)] ring-[var(--color-border)]",
        success:
          "bg-[var(--color-success-muted)] text-[var(--color-success-emphasis)] ring-[var(--color-success-ring)]",
        warning:
          "bg-[var(--color-warning-muted)] text-[var(--color-warning-emphasis)] ring-[var(--color-warning-ring)]",
        destructive:
          "bg-[var(--color-destructive-muted)] text-[var(--color-destructive-emphasis)] ring-[var(--color-destructive-ring)]",
        info: "bg-[var(--color-info-muted)] text-[var(--color-info-emphasis)] ring-[var(--color-info-ring)]",
        outline: "bg-[var(--color-card)] text-[var(--color-foreground)] ring-[var(--color-border)]",
      },
    },
    defaultVariants: { variant: "default" },
  }
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
