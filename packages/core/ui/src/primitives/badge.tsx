import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_SOFT } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"

// Badges and chips take radius sm (CI §6), the badge height of the density roles
// (20 px in both steps, no target) and the 13 px floor of the type scale
// (`text-small`; `leading-4` keeps the one line inside it) at weight 600 (the
// guide's weights are 400, 600 and 700). Its icon is 12 px (the density
// section's named deviation). A badge that is a link hovers on the hover fill.
// The status variants follow the tone model and its ONE vocabulary: tint +
// foreground text, rim in the tone (TONE_SOFT + TONE_BORDER; CI §3.3 "-soft:
// Text darauf --cd-schwarz"). The ink is never text on a tint. `danger` is the
// status red; `destructive` is its deprecated name, kept for existing calls.
const badgeVariants = cva(
  `group/badge inline-flex h-badge w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-small leading-4 font-semibold whitespace-nowrap transition-all ${FOCUS_RING} has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-danger [&>svg]:pointer-events-none [&>svg]:size-3!`,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-accent",
        danger: `${TONE_SOFT.danger} ${TONE_BORDER.danger}`,
        /** @deprecated Use `danger`: one name per tone. */
        destructive: `${TONE_SOFT.danger} ${TONE_BORDER.danger}`,
        success: `${TONE_SOFT.success} ${TONE_BORDER.success}`,
        warning: `${TONE_SOFT.warning} ${TONE_BORDER.warning}`,
        info: `${TONE_SOFT.info} ${TONE_BORDER.info}`,
        outline: "border-border text-foreground [a]:hover:bg-accent",
        ghost: "hover:bg-accent",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

// `asChild` renders the badge's classes and data attributes on its one child (a link, say),
// like Button; `data-slot` and `data-variant` name the part for styling and tests.
function Badge({
  className,
  variant = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant ?? undefined}
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
