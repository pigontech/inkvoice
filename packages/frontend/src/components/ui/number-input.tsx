import * as React from "react"
import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface NumberInputProps
  extends Omit<React.ComponentProps<"input">, "type" | "value" | "onChange" | "min" | "max" | "step"> {
  value: number | string | undefined | null
  onValueChange: (value: number) => void
  min?: number
  max?: number
  decimals?: number
  allowNegative?: boolean
  integer?: boolean
}

function sanitize(input: string, opts: { allowNegative: boolean; integer: boolean }): string {
  let result = ""
  let hasDecimal = false
  let hasNegative = false

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (ch === "-" && opts.allowNegative && i === 0 && !hasNegative) {
      hasNegative = true
      result += ch
    } else if (ch === "." && !opts.integer && !hasDecimal) {
      hasDecimal = true
      result += ch
    } else if (ch >= "0" && ch <= "9") {
      result += ch
    }
  }
  return result
}

function formatForDisplay(value: number | string | undefined | null, decimals?: number): string {
  if (value === undefined || value === null || value === "") return ""
  const num = typeof value === "string" ? parseFloat(value) : value
  if (Number.isNaN(num)) return ""
  if (decimals !== undefined) return num.toFixed(decimals)
  return String(num)
}

function NumberInput({
  value,
  onValueChange,
  min = 0,
  max,
  decimals,
  allowNegative = false,
  integer = false,
  className,
  onFocus: onFocusProp,
  onBlur: onBlurProp,
  ...props
}: NumberInputProps) {
  const isFocused = useRef(false)
  const [displayValue, setDisplayValue] = useState(() => formatForDisplay(value, decimals))

  useEffect(() => {
    if (!isFocused.current) {
      setDisplayValue(formatForDisplay(value, decimals))
    }
  }, [value, decimals])

  const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocused.current = true
    requestAnimationFrame(() => e.target.select())
    onFocusProp?.(e)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = sanitize(e.target.value, { allowNegative, integer })
    setDisplayValue(raw)
  }

  const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
    isFocused.current = false
    const parsed = parseFloat(displayValue)
    let final = Number.isNaN(parsed) ? min : parsed
    if (min !== undefined && final < min) final = min
    if (max !== undefined && final > max) final = max
    if (decimals !== undefined) final = parseFloat(final.toFixed(decimals))
    setDisplayValue(formatForDisplay(final, decimals))
    onValueChange(final)
    onBlurProp?.(e)
  }

  return (
    <Input
      {...props}
      type="text"
      inputMode={integer ? "numeric" : "decimal"}
      className={cn("tabular-nums", className)}
      value={displayValue}
      onFocus={handleFocus}
      onChange={handleChange}
      onBlur={handleBlur}
    />
  )
}

export { NumberInput }
