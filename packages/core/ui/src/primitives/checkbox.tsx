import type * as React from "react"
import { Check, Minus } from "lucide-react"
import { Checkbox as CheckboxPrimitive } from "radix-ui"

import { Icon } from "../kit/icon.js"
import { useFieldControl } from "../lib/field-control.js"
import { FOCUS_RING } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"

/**
 * A checkbox (CI §8 "Checkbox und Radio"): an 18 px box inset like a field, on the ground with a
 * 1.5 px edge in --input. Checked, its edge and its check take --interaction and the box keeps
 * its ground (the guide's rule: a blue fill would reach only 2.45:1 on a raised dark surface);
 * `checked="indeterminate"` (some rows of a list chosen) draws a minus, read as "mixed". The
 * pointer target reaches 24 px around the box (WCAG 2.5.8). A Radix checkbox: a button with
 * `role="checkbox"` and `aria-checked`, Space toggles it. Its focus ring sits flush in a table
 * cell. Disabled is opaque, never faded (CI §8): the hover fill, a line edge, a quiet mark.
 * Forced colours keep its edge and mark and draw a checked one's edge in Highlight (theme.css).
 * Inside a `Field` it takes the Field's id, hint and error; beside a `Label` that follows it, a
 * disabled one quiets the label (`peer`).
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  const control = useFieldControl(props)
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer group/checkbox border-input bg-background text-interaction relative inline-flex size-[1.125rem] shrink-0 cursor-pointer items-center justify-center rounded-[calc(var(--radius-sm)-2px)] border-[1.5px] transition-[color,box-shadow,border-color]",
        "before:absolute before:-inset-[0.1875rem]",
        "data-[state=checked]:border-interaction data-[state=indeterminate]:border-interaction",
        // Tailwind writes a state's edge after `disabled:` and `aria-invalid:` at the same
        // specificity, so both name the states too, as Switch does: a disabled box keeps a line
        // edge and an invalid one a danger edge, checked or mixed alike.
        "aria-invalid:border-danger aria-invalid:data-[state=checked]:border-danger aria-invalid:data-[state=indeterminate]:border-danger",
        "disabled:bg-accent disabled:border-border disabled:data-[state=checked]:border-border disabled:data-[state=indeterminate]:border-border disabled:text-muted-foreground disabled:cursor-not-allowed",
        FOCUS_RING,
        "in-[td]:focus-visible:ring-offset-0",
        className,
      )}
      {...control}
    >
      <CheckboxPrimitive.Indicator
        data-slot="checkbox-indicator"
        className="pointer-events-none flex items-center justify-center"
      >
        <Icon icon={Check} className="group-data-[state=indeterminate]/checkbox:hidden" />
        <Icon icon={Minus} className="hidden group-data-[state=indeterminate]/checkbox:block" />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
