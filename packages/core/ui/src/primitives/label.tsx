import type * as React from "react"
import { Label as LabelPrimitive } from "radix-ui"

import { MICRO_LABEL } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

/**
 * A control's name (CI §8): 13 px at 600 in the text colour, its `htmlFor` naming the control.
 * Above a field (`Field` sets it), or beside a `Checkbox` that comes first with the `peer` class
 * (Checkbox has it): the label of a disabled one turns quiet with the not-allowed cursor.
 */
function Label({ className, ...props }: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      className={cn(
        MICRO_LABEL,
        "text-foreground inline-flex items-center gap-2 select-none",
        "peer-disabled:text-muted-foreground peer-disabled:cursor-not-allowed",
        className,
      )}
      {...props}
    />
  )
}

export { Label }
