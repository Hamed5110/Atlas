import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[var(--radius-sm)] text-sm font-semibold transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-ring)] disabled:pointer-events-none disabled:opacity-50 motion-safe:active:scale-[0.97] cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "gradient-hero text-[var(--color-primary-foreground)] shadow-md hover:shadow-lg",
        gradient:
          "gradient-hero text-[var(--color-primary-foreground)] shadow-md hover:shadow-lg",
        secondary:
          "bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)] hover:bg-[var(--color-secondary-hover)]",
        outline:
          "border border-[var(--color-input)] bg-[var(--color-card)] hover:bg-[var(--color-secondary)] text-[var(--color-foreground)]",
        ghost: "hover:bg-[var(--color-secondary)] text-[var(--color-foreground)]",
        destructive:
          "bg-[var(--color-destructive)] text-[var(--color-destructive-foreground)] shadow-sm hover:bg-[var(--color-destructive-hover)]",
        success:
          "bg-[var(--color-success)] text-[var(--color-success-foreground)] shadow-sm hover:bg-[var(--color-success-hover)]",
        warning:
          "bg-[var(--color-warning)] text-[var(--color-warning-foreground)] shadow-sm hover:bg-[var(--color-warning-hover)]",
        link: "text-[var(--color-primary)] underline-offset-4 hover:underline shadow-none",
      },
      size: {
        // WCAG 2.5.8 Target Size (Minimum) ≥ 24px; sm stays ≥ 32px / 36px on coarse pointers via CSS.
        sm: "h-9 min-h-9 px-3 text-xs",
        default: "h-10 min-h-10 px-4",
        lg: "h-11 min-h-11 px-6 text-base",
        icon: "h-11 w-11 min-h-11 min-w-11 lg:h-9 lg:w-9 lg:min-h-9 lg:min-w-9",
        "icon-sm": "h-11 w-11 min-h-11 min-w-11 lg:h-9 lg:w-9 lg:min-h-9 lg:min-w-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, type = "button", ...props }, ref) => (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  )
);
Button.displayName = "Button";

export { buttonVariants };
