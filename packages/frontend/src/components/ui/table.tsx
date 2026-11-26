"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

function Table({
  className,
  stickyFirstColumn,
  ...props
}: React.ComponentProps<"table"> & { stickyFirstColumn?: boolean }) {
  return (
    <div
      data-slot="table-container"
      data-sticky-first={stickyFirstColumn ? "true" : undefined}
      className="relative w-full overflow-x-auto"
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("bg-muted [&_tr]:border-b [&_tr]:hover:bg-transparent", className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        "border-t bg-muted/50 font-medium [&>tr]:last:border-b-0",
        className
      )}
      {...props}
    />
  )
}

function TableRow({ className, onClick, onKeyDown, ...props }: React.ComponentProps<"tr">) {
  // When a row has a click handler, make it keyboard-accessible: focusable
  // and Enter/Space activates the same handler. Pages that don't pass onClick
  // get a regular non-interactive row.
  const isInteractive = typeof onClick === "function";
  const interactiveProps = isInteractive
    ? {
        tabIndex: 0,
        role: "button" as const,
        onKeyDown: (e: React.KeyboardEvent<HTMLTableRowElement>) => {
          onKeyDown?.(e);
          if (e.defaultPrevented) return;
          if (e.key === "Enter" || e.key === " ") {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "BUTTON" || tag === "A" || tag === "TEXTAREA") return;
            e.preventDefault();
            onClick?.(e as unknown as React.MouseEvent<HTMLTableRowElement>);
          }
        },
      }
    : { onKeyDown };
  return (
    <tr
      data-slot="table-row"
      onClick={onClick}
      className={cn(
        "border-b transition-colors hover:bg-muted has-aria-expanded:bg-muted data-[state=selected]:bg-brand-soft",
        isInteractive &&
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1",
        className
      )}
      {...interactiveProps}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      scope="col"
      className={cn(
        "h-8 px-2.5 text-left align-middle text-xs font-medium whitespace-nowrap text-secondary-foreground first:pl-3.5 last:pr-3.5 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "h-[42px] px-2.5 py-1.5 align-middle whitespace-nowrap first:pl-3.5 last:pr-3.5 [&:has([role=checkbox])]:pr-0",
        className
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<"caption">) {
  return (
    <caption
      data-slot="table-caption"
      className={cn("mt-4 text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
