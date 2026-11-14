import { Children, type ReactNode } from "react"
import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { FOCUS_RING } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"

/**
 * A filled button disabled (CI §8 "Deaktiviert"): the hover fill with a line edge, no shadow,
 * no lift.
 */
const DISABLED_FILLED =
  "disabled:bg-accent disabled:shadow-none disabled:border-border disabled:translate-y-0"

/**
 * In a table cell the ring sits flush on the button (no offset), so a pinned cell or the scroll
 * region's edge never cuts it.
 */
const FOCUS_IN_CELL = "in-[td]:focus-visible:ring-offset-0"

/**
 * A toolbar button's label (`data-slot="button-label"`, the span `Button` puts its text in):
 * inside a bar (the container named `bar`: `ViewBar`, `Toolbar`, `StatusStrip`, lib/bar.ts)
 * narrower than 36rem a button WITH an icon hides it visually and keeps it as its accessible name
 * (`sr-only`, never `display: none`), and turns square around the icon at the control's height.
 * Any other container (a table's region, a card's head) leaves it alone. A button without an icon
 * keeps its label, or it would be an empty box. An inline card at 760 px keeps its labels.
 */
const TOOLBAR_COLLAPSE =
  "@max-[36rem]/bar:has-[>svg]:min-w-control @max-[36rem]/bar:has-[>svg]:px-0 @max-[36rem]/bar:has-[>svg]:[&>[data-slot=button-label]]:sr-only"

// Miragon CI §8: weight 600, 13 px; primary = blue fill with white text and shadow-1, hover
// deeper blue + shadow-2 + a 1px lift; outline = the raised surface (the guide's flaeche-hoch)
// with a line border, hover blue border and text on the hover fill. Sizes and the radius come
// from the density roles (theme.css): 28 px controls, 24 px xs, 36 px lg, the sm radius,
// each a named deviation of the density section in CLAUDE.md; the comfortable step on touch.
// Every variant has a 1 px edge, transparent where it draws none, so a Windows contrast theme
// (forced colours) paints it and the button keeps its outline there. Disabled is opaque and
// neutral, never faded: quiet text and icon, per variant the fill the guide names, no hover
// (each `disabled:` class outranks its `hover:` one), the not-allowed cursor.
const buttonCva = cva(
  `inline-flex shrink-0 items-center justify-center gap-2 rounded-button border border-transparent text-dense font-semibold whitespace-nowrap transition-[color,background-color,border-color,box-shadow,translate] disabled:cursor-not-allowed disabled:text-muted-foreground aria-invalid:border-danger ${FOCUS_RING} ${FOCUS_IN_CELL} [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4`,
  {
    variants: {
      variant: {
        default: `bg-primary text-primary-foreground shadow-1 hover:bg-primary-hover hover:shadow-2 hover:-translate-y-px active:translate-y-0 ${DISABLED_FILLED}`,
        destructive: `bg-destructive text-destructive-foreground shadow-1 hover:bg-destructive/90 hover:shadow-2 ${DISABLED_FILLED}`,
        outline:
          "border-border bg-raised text-foreground hover:border-focus hover:bg-accent hover:text-accent-foreground disabled:border-border disabled:bg-raised",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-accent disabled:bg-secondary disabled:border-border",
        ghost: "hover:bg-accent hover:text-accent-foreground disabled:bg-transparent",
        // Chrome labels at 400 (§5.14), a named deviation from §8's 600: an icon and its label
        // in a view's bar, collapsing to the icon in a narrow container.
        toolbar: `gap-1.5 px-2 font-normal text-foreground hover:bg-accent hover:text-accent-foreground disabled:bg-transparent has-[>svg]:px-2 ${TOOLBAR_COLLAPSE}`,
        link: "border-0 text-link underline-offset-4 hover:underline disabled:no-underline",
      },
      size: {
        default: "min-h-control px-3 has-[>svg]:px-2.5",
        xs: "min-h-control-xs gap-1.5 px-2 text-small has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-control gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "min-h-control-lg px-4 has-[>svg]:px-3",
        icon: "size-control",
        "icon-xs": "size-control-xs [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-control",
        "icon-lg": "size-control-lg",
      },
    },
    compoundVariants: [
      { variant: "toolbar", size: ["default", "sm", "lg"], className: "px-2 has-[>svg]:px-2" },
    ],
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)

/**
 * The button's classes, merged: a variant's edge colour or padding replaces the base's, so a
 * link or a `DrillButton` styled with them looks like the `Button` itself.
 */
function buttonVariants(options?: Parameters<typeof buttonCva>[0]): string {
  return cn(buttonCva(options))
}

/** A toolbar button's text children, each in a label span that can collapse. */
function toolbarChildren(children: ReactNode): ReactNode {
  return Children.map(children, (child) =>
    typeof child === "string" || typeof child === "number" ? (
      <span data-slot="button-label">{child}</span>
    ) : (
      child
    ),
  )
}

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  children,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonCva> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={buttonVariants({ variant, size, className })}
      {...props}
    >
      {variant === "toolbar" && !asChild ? toolbarChildren(children) : children}
    </Comp>
  )
}

export { Button, buttonVariants }
