import {
  ArrowUpRight,
  Ban,
  Check,
  CheckCheck,
  CircleAlert,
  Contrast,
  type LucideIcon,
  Pause,
  Pencil,
  Repeat,
  Send,
  Timer,
  X,
} from "lucide-react";
import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { STATUS_COLORS } from "@/lib/constants";
import { cn } from "@/lib/utils";

// Every status carries an icon as well as a color, so it never reads by color alone.
const STATUS_ICONS: Record<string, LucideIcon> = {
  draft: Pencil,
  sent: Send,
  paid: Check,
  partially_paid: Contrast,
  overdue: CircleAlert,
  voided: Ban,
  complete: CheckCheck,
  accepted: Check,
  rejected: X,
  expired: Timer,
  converted: ArrowUpRight,
  active: Repeat,
  paused: Pause,
  completed: CheckCheck,
};

/** Status tag for invoices, quotes and recurring invoices. */
export function StatusBadge({
  status,
  children,
  className,
}: {
  status: string;
  children: ReactNode;
  className?: string;
}) {
  const Icon = STATUS_ICONS[status];
  return (
    <Badge
      variant="secondary"
      className={cn("gap-1 border-transparent pr-1.5 pl-[5px]", STATUS_COLORS[status], className)}
    >
      {Icon && <Icon aria-hidden="true" />}
      {children}
    </Badge>
  );
}
