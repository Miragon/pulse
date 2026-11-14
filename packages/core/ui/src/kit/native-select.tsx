import type { ComponentProps } from "react"
import { cn } from "../lib/utils.js"
import { useFieldControl } from "../lib/field-control.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { FIELD_TEXT } from "../lib/typography.js"

/**
 * `--input`, not `--border`: the decorative border reaches only 1.26:1 against the card. A
 * control of the density roles (28 px, 36 px on touch, as a minimum), the sm radius in both
 * steps (§8), on the ground like `Input`. Text 13 px, 16 px on a coarse pointer (FIELD_TEXT).
 * Disabled is opaque, never faded (CI §8). In a table cell its ring sits flush (no offset), so a
 * pinned cell never cuts it.
 */
const FIELD_CONTROL = cn(
  "border-input bg-background text-foreground aria-invalid:border-danger min-h-control rounded-sm border px-3",
  FIELD_TEXT,
  "disabled:bg-accent disabled:text-muted-foreground disabled:cursor-not-allowed",
  FOCUS_RING,
  "in-[td]:focus-visible:ring-offset-0",
)

/**
 * Native on purpose: widget iframes keep the host's popover positioning out of the picture.
 * Inside a `Field` it takes the Field's id, hint and error.
 */
export function NativeSelect({ className, ...props }: ComponentProps<"select">) {
  const control = useFieldControl(props)
  return <select {...control} className={cn(FIELD_CONTROL, className)} />
}
