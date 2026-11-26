import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type TextareaHTMLAttributes, type SelectHTMLAttributes, type LabelHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const fieldClass =
  "flex w-full rounded-[var(--radius-sm)] border border-[var(--color-input)] bg-[var(--color-card)] px-3 text-base text-[var(--color-foreground)] shadow-xs transition-colors placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-primary-ring)] aria-[invalid=true]:border-[var(--color-destructive)] aria-[invalid=true]:ring-2 aria-[invalid=true]:ring-[color-mix(in_srgb,var(--color-destructive)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-60 lg:text-sm";

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input ref={ref} className={cn(fieldClass, "h-11 lg:h-10", className)} {...props} />
  )
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} className={cn(fieldClass, "min-h-24 py-2 lg:min-h-20", className)} {...props} />
  )
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select ref={ref} className={cn(fieldClass, "h-11 appearance-none bg-no-repeat pe-8 cursor-pointer lg:h-10", className)}
      style={{
        backgroundImage:
          "url(\"data:image/svg+xml;charset=UTF-8,%3csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3e%3cpolyline points='6 9 12 15 18 9'%3e%3c/polyline%3e%3c/svg%3e\")",
        backgroundPosition: "right 0.6rem center",
        backgroundSize: "1em",
      }}
      {...props}
    >
      {children}
    </select>
  )
);
Select.displayName = "Select";

export function Label({ className, ...props }: LabelHTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        "text-[0.8125rem] font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]",
        className
      )}
      {...props}
    />
  );
}

const FIELD_CONTROLS = new Set<unknown>([Input, Select, Textarea, "input", "select", "textarea"]);

export function Field({
  label,
  error,
  hint,
  children,
  className,
  htmlFor,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  const autoId = useId();
  const control =
    isValidElement<{ id?: string }>(children) && FIELD_CONTROLS.has(children.type) ? children : null;
  const targetId = htmlFor ?? control?.props.id ?? (control ? autoId : undefined);
  const messageId = error || hint ? `${targetId ?? autoId}-hint` : undefined;
  const controlProps = {
    ...(control && !control.props.id && !htmlFor ? { id: autoId } : {}),
    "aria-invalid": error ? true : undefined,
    "aria-describedby": messageId,
  };
  return (
    <div className={cn("flex flex-col gap-2", error && "field-invalid", className)}>
      <Label htmlFor={targetId}>{label}</Label>
      {control ? cloneElement(control, controlProps) : children}
      {error ? (
        <p id={messageId} role="alert" className="text-xs font-medium text-[var(--color-destructive-emphasis)]">{error}</p>
      ) : hint ? (
        <p id={messageId} className="text-xs text-[var(--color-muted-foreground)]">{hint}</p>
      ) : null}
    </div>
  );
}
