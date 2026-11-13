import type * as React from "react"

import { useFieldControl } from "../lib/field-control.js"
import { FIELD_FOCUS } from "../lib/focus-ring.js"
import { FIELD_TEXT } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

/**
 * A multi-line field, drawn like `Input`: on the ground with the field edge (--input), the sm
 * radius, text 13 px and 16 px on a coarse pointer (FIELD_TEXT), the same focus edge. At least
 * three lines high (`lh`, so it follows the text's size and line height; the padding and edge
 * come on top), taller with `rows`, resizable in height only. For code or a JSON value add
 * `font-mono`. Disabled is opaque, never faded (CI §8). Inside a `Field` it takes the Field's id,
 * hint and error.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  const control = useFieldControl(props)
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "border-input placeholder:text-muted-foreground bg-background text-foreground min-h-[calc(3lh+0.5rem+2px)] w-full min-w-0 resize-y rounded-sm border px-3 py-1 outline-hidden transition-[color,box-shadow,border-color]",
        FIELD_TEXT,
        "disabled:bg-accent disabled:text-muted-foreground disabled:cursor-not-allowed disabled:resize-none",
        FIELD_FOCUS,
        "aria-invalid:border-danger aria-invalid:ring-danger aria-invalid:ring-1",
        className,
      )}
      {...control}
    />
  )
}

export { Textarea }
