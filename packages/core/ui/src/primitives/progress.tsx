import type * as React from "react"
import { Progress as ProgressPrimitive } from "radix-ui"

import { cn } from "../lib/utils.js"

/** The bar's name: what makes progress ("Progress of the bulk operation"), or the element naming it. */
type ProgressName =
  | { "aria-label": string; "aria-labelledby"?: never }
  | { "aria-labelledby": string; "aria-label"?: never }

export type ProgressProps = Omit<
  React.ComponentProps<typeof ProgressPrimitive.Root>,
  | "value"
  | "max"
  | "getValueLabel"
  | "children"
  | "aria-label"
  | "aria-labelledby"
  | "aria-valuetext"
> &
  ProgressName & {
    /**
     * Done so far, from 0 to `max` (clamped into it). `null` or left out while the amount is
     * unknown: the bar runs instead of filling.
     */
    value?: number | null
    /** The whole amount, above 0. Default 100; a given `max` that is no amount counts as 1. */
    max?: number
    /**
     * The progress in words, read out as the bar's value: "3 of 12 done", "Loading…". Required:
     * a percentage alone says nothing about what is counted, and a running bar has no number.
     */
    valueText: string
  }

/** The amount clamped into 0…max, `null` while it is unknown; a `max` that is no amount counts as 1. */
function amounts(value: number | null | undefined, max: number) {
  const whole = Number.isFinite(max) && max > 0 ? max : 1
  const known = value !== null && value !== undefined && Number.isFinite(value)
  return { whole, done: known ? Math.min(Math.max(value, 0), whole) : null }
}

/**
 * A progress bar (`role="progressbar"`): a 4 px track on the ground (the muted role) with a fill
 * in --interaction, 3:1 or more against the track in both modes (ROLE_CONTRAST_PAIRS). With a
 * `value` it fills to its share of `max`; without one it is indeterminate: a segment runs along
 * the track, and under reduced motion it stands still as a dashed line across the whole track,
 * never a fill that would read as a share. Its name (`aria-label` or `aria-labelledby`) and its
 * value in words (`valueText`) are required. Forced colours draw the track's outline and the fill
 * in CanvasText (theme.css).
 */
function Progress({ className, value, max = 100, valueText, ...props }: ProgressProps) {
  const { whole, done } = amounts(value, max)
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={done}
      max={whole}
      aria-valuetext={valueText}
      className={cn("bg-muted rounded-pill relative h-1 w-full overflow-hidden", className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className={cn(
          "bg-interaction h-full",
          done === null
            ? "animate-progress-indeterminate motion-reduce:border-interaction w-2/5 motion-reduce:w-full motion-reduce:animate-none motion-reduce:border-t-4 motion-reduce:border-dashed motion-reduce:bg-transparent"
            : "w-full transition-transform",
        )}
        style={
          done === null ? undefined : { transform: `translateX(-${100 - (done / whole) * 100}%)` }
        }
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
