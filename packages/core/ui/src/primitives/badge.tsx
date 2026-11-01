import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"

import { FOCUS_RING } from "../lib/focus-ring.js"
import { TONE_BORDER, TONE_SOFT } from "../lib/tone-utils.js"
import { cn } from "../lib/utils.js"

// Badges and chips take radius sm (CI §6) and the 13 px floor of the type
// scale (`text-small`; `leading-4` keeps the one line inside the 20 px badge).
// The status variants follow the tone model and its ONE vocabulary: tint +
// foreground text, rim in the tone (TONE_SOFT + TONE_BORDER; CI §3.3 "-soft:
// Text darauf --cd-schwarz"). The ink is never text on a tint. `danger` is the
// status red; `destructive` is its deprecated name, kept for existing calls.
const badgeVariants = cva(
  `group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent px-2 py-0.5 text-small leading-4 font-medium whitespace-nowrap transition-all ${FOCUS_RING} has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-danger [&>svg]:pointer-events-none [&>svg]:size-3!`,
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary-hover",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        danger: `${TONE_SOFT.danger} ${TONE_BORDER.danger}`,
        /** @deprecated Use `danger`: one name per tone. */
        destructive: `${TONE_SOFT.danger} ${TONE_BORDER.danger}`,
        success: `${TONE_SOFT.success} ${TONE_BORDER.success}`,
        warning: `${TONE_SOFT.warning} ${TONE_BORDER.warning}`,
        info: `${TONE_SOFT.info} ${TONE_BORDER.info}`,
        outline: "border-border text-foreground [a]:hover:bg-muted",
        ghost: "hover:bg-muted",
        link: "text-link underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props,
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
