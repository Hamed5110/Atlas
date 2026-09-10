import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset",
  {
    variants: {
      variant: {
        default: "bg-[var(--color-primary-muted)] text-[var(--color-primary)] ring-[hsl(243_75%_59%/0.25)]",
        secondary: "bg-[var(--color-secondary)] text-[var(--color-muted-foreground)] ring-[var(--color-border)]",
        success: "bg-[hsl(142_71%_95%)] text-[hsl(142_71%_30%)] ring-[hsl(142_71%_39%/0.3)]",
        warning: "bg-[hsl(38_92%_94%)] text-[hsl(32_95%_32%)] ring-[hsl(38_92%_44%/0.35)]",
        destructive: "bg-[hsl(0_72%_96%)] text-[hsl(0_72%_42%)] ring-[hsl(0_72%_51%/0.3)]",
        info: "bg-[hsl(217_91%_95%)] text-[hsl(217_91%_40%)] ring-[hsl(217_91%_55%/0.3)]",
        outline: "bg-white text-[var(--color-foreground)] ring-[var(--color-border)]",
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
