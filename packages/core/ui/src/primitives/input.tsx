import type * as React from "react"

import { useFieldControl } from "../lib/field-control.js"
import { FIELD_FOCUS } from "../lib/focus-ring.js"
import { FIELD_TEXT } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  // Inside a `Field`: its id, hint and error (`useFieldControl`).
  const control = useFieldControl(props)
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // A control of the density roles (28 px, 36 px on touch; the minimum, so larger text
        // grows it), the sm radius in both steps (§8), on the ground: an inset field. Border in
        // --input (3:1 on its surface). Text 13 px, 16 px on a coarse pointer (FIELD_TEXT).
        // Disabled is opaque, never faded (CI §8): the hover fill and quiet text. The focus edge
        // is the border plus a ring of the rest of --focus-width (FIELD_FOCUS).
        "border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground bg-background file:text-dense min-h-control w-full min-w-0 rounded-sm border px-3 py-0.5 transition-[color,box-shadow,border-color] file:inline-flex file:border-0 file:bg-transparent file:font-semibold focus-visible:outline-hidden",
        FIELD_TEXT,
        "disabled:bg-accent disabled:text-muted-foreground disabled:cursor-not-allowed",
        FIELD_FOCUS,
        "aria-invalid:border-danger aria-invalid:ring-danger aria-invalid:ring-1",
        className,
      )}
      {...control}
    />
  )
}

export { Input }
