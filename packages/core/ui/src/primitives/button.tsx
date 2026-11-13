import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { FOCUS_RING } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"

/**
 * A filled button disabled (CI §8 "Deaktiviert"): the hover fill with a line edge (an inset
 * ring, so the box keeps its size), no shadow, no lift.
 */
const DISABLED_FILLED =
  "disabled:bg-accent disabled:shadow-none disabled:inset-ring disabled:inset-ring-border disabled:translate-y-0"

// Miragon CI §8: radius md, weight 600, 13 px; primary = blue fill with white
// text and shadow-1, hover deeper blue + shadow-2 + a 1px lift; outline = the
// raised surface (the guide's flaeche-hoch) with a line border, hover blue
// border and text on the accent tint. Disabled is opaque and neutral, never
// faded: quiet text and icon, per variant the fill the guide names, no hover
// (each `disabled:` class outranks its `hover:` one), the not-allowed cursor.
const buttonVariants = cva(
  `inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-dense font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,translate] disabled:cursor-not-allowed disabled:text-muted-foreground aria-invalid:border-danger ${FOCUS_RING} [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground shadow-1 hover:bg-primary-hover hover:shadow-2 hover:-translate-y-px active:translate-y-0 ${DISABLED_FILLED}`,
        destructive: `bg-destructive text-destructive-foreground shadow-1 hover:bg-destructive/90 hover:shadow-2 ${DISABLED_FILLED}`,
        outline:
          "border border-border bg-raised text-foreground hover:border-focus hover:bg-accent hover:text-accent-foreground disabled:border-border disabled:bg-raised",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:bg-secondary disabled:inset-ring disabled:inset-ring-border",
        ghost: "hover:bg-accent hover:text-accent-foreground disabled:bg-transparent",
        link: "text-link underline-offset-4 hover:underline disabled:no-underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        xs: "h-6 gap-1 rounded-sm px-2 text-small has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
        "icon-xs": "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
