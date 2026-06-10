import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { TableHead } from "@/components/ui/table";

export interface SortState {
  key: string;
  direction: "asc" | "desc";
}

interface SortableColumnHeaderProps {
  label: string;
  sortKey: string;
  currentSort: SortState | null;
  onSort: (key: string, direction: "asc" | "desc" | null) => void;
  className?: string;
}

export function SortableColumnHeader({
  label,
  sortKey,
  currentSort,
  onSort,
  className,
}: SortableColumnHeaderProps) {
  const isActive = currentSort?.key === sortKey;
  const direction = isActive ? currentSort.direction : null;

  const handleClick = () => {
    if (!isActive) {
      onSort(sortKey, "asc");
    } else if (direction === "asc") {
      onSort(sortKey, "desc");
    } else {
      onSort(sortKey, null);
    }
  };

  return (
    <TableHead
      className={className}
      aria-sort={isActive ? (direction === "asc" ? "ascending" : "descending") : "none"}
    >
      <button
        type="button"
        onClick={handleClick}
        className="flex items-center gap-1 w-full cursor-pointer select-none hover:text-foreground transition-colors -mx-2 px-2 -my-1 py-1 rounded"
      >
        {label}
        {isActive && direction === "asc" && <ArrowUp className="size-3.5 text-foreground" />}
        {isActive && direction === "desc" && <ArrowDown className="size-3.5 text-foreground" />}
        {!isActive && <ArrowUpDown className="size-3.5 text-muted-foreground/50" />}
      </button>
    </TableHead>
  );
}

export function sortData<T>(data: T[], sort: SortState | null): T[] {
  if (!sort) return data;
  return [...data].sort((a, b) => {
    const aVal = (a as Record<string, unknown>)[sort.key];
    const bVal = (b as Record<string, unknown>)[sort.key];
    if (aVal == null && bVal == null) return 0;
    if (aVal == null) return 1;
    if (bVal == null) return -1;
    if (typeof aVal === "number" && typeof bVal === "number") {
      return sort.direction === "asc" ? aVal - bVal : bVal - aVal;
    }
    const aStr = String(aVal).toLowerCase();
    const bStr = String(bVal).toLowerCase();
    const cmp = aStr.localeCompare(bStr);
    return sort.direction === "asc" ? cmp : -cmp;
  });
}
