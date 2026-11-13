import type * as React from "react"

import { FIELD_TEXT } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        // Input border in --input (3:1 on its surface); focus turns border and a
        // 1px ring --focus: a 2px opaque blue edge (CI §8). Text 13 px, 16 px on
        // a coarse pointer (FIELD_TEXT). Disabled is opaque, never faded (CI §8):
        // the hover fill and quiet text.
        "border-input selection:bg-primary selection:text-primary-foreground file:text-foreground placeholder:text-muted-foreground bg-background file:text-dense h-9 w-full min-w-0 rounded-md border px-3 py-1 outline-hidden transition-[color,box-shadow,border-color] file:inline-flex file:h-7 file:border-0 file:bg-transparent file:font-semibold",
        FIELD_TEXT,
        "disabled:bg-accent disabled:text-muted-foreground disabled:cursor-not-allowed",
        "focus-visible:border-focus focus-visible:ring-focus focus-visible:ring-1",
        "aria-invalid:border-danger aria-invalid:ring-danger aria-invalid:ring-1",
        className,
      )}
      {...props}
    />
  )
}

export { Input }
