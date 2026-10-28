import type { ComponentProps } from "react"
import { cn, FOCUS_RING } from "@miragon/mcp-toolkit-ui"

/** `--input`, not `--border`: the decorative border reaches only 1.26:1 against the card. */
export const FIELD_CONTROL = cn(
  "border-input bg-background text-foreground text-dense aria-invalid:border-danger h-9 rounded-md border px-2 disabled:cursor-not-allowed disabled:opacity-50",
  FOCUS_RING,
)

/** Native on purpose: widget iframes keep the host's popover positioning out of the picture. */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  return <select {...props} className={cn(FIELD_CONTROL, className)} />
}
