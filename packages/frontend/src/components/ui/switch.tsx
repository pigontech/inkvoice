// Plain switch control, matching the kit's dependency-free checkbox.tsx style
// (no Radix, no new dependency). Enable/disable is a switch affordance.
import { cn } from "@/lib/utils";

interface SwitchProps {
  id?: string;
  checked: boolean;
  disabled?: boolean;
  onCheckedChange: (checked: boolean) => void;
  "aria-label"?: string;
  className?: string;
}

export function Switch({
  checked,
  disabled,
  onCheckedChange,
  className,
  ...rest
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "inline-flex h-5 w-9 shrink-0 items-center rounded-[5px] border border-transparent transition-colors",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-brand" : "bg-border-strong",
        className,
      )}
      {...rest}
    >
      <span
        className={cn(
          "pointer-events-none block h-4 w-4 rounded-[3px] bg-card shadow-sm transition-transform",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}
