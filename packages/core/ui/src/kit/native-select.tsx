import type { ComponentProps } from "react"
import { cn } from "../lib/utils.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { FIELD_TEXT } from "../lib/typography.js"

/**
 * `--input`, not `--border`: the decorative border reaches only 1.26:1 against the card. Text
 * 13 px, 16 px on a coarse pointer (FIELD_TEXT). Disabled is opaque, never faded (CI §8).
 */
const FIELD_CONTROL = cn(
  "border-input bg-background text-foreground aria-invalid:border-danger h-9 rounded-md border px-2",
  FIELD_TEXT,
  "disabled:bg-accent disabled:text-muted-foreground disabled:cursor-not-allowed",
  FOCUS_RING,
)

/** Native on purpose: widget iframes keep the host's popover positioning out of the picture. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cn(FIELD_CONTROL, className)} />
}
