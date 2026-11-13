import { createContext, useContext } from "react"
import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import { FOCUS_RING, FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"
import { useUiLocale } from "../locale/locale-provider.js"
import { formatCountIn } from "../locale/ui-messages.js"

type TabsVariant = "default" | "line"

/** The list's variant, which its triggers take their shape from. */
const TabsVariantContext = createContext<TabsVariant>("default")

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      data-orientation={orientation}
      orientation={orientation}
      className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
      {...props}
    />
  )
}

/**
 * `default` is the boxed switch inside a card, at least the control's height, its tabs
 * stretched to the box. `line` is a view's tab bar (the webview's, CI §8): at least a toolbar
 * high, with a rule under it, the active tab on the hover fill with a 2 px bar in
 * `--interaction`. Both take a minimum height, never a fixed one, so text at 200 % grows them
 * instead of clipping (D9).
 */
const tabsListVariants = cva(
  "group/tabs-list inline-flex text-muted-foreground group-data-[orientation=vertical]/tabs:h-fit group-data-[orientation=vertical]/tabs:flex-col",
  {
    variants: {
      variant: {
        default:
          "bg-muted w-fit items-stretch justify-center rounded-sm p-[3px] group-data-[orientation=horizontal]/tabs:min-h-control",
        line: "w-full items-stretch justify-start border-b bg-transparent pr-gutter pl-2 group-data-[orientation=horizontal]/tabs:min-h-toolbar group-data-[orientation=vertical]/tabs:border-r group-data-[orientation=vertical]/tabs:border-b-0",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
)

function TabsList({
  className,
  variant = "default",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const shape = variant ?? "default"
  return (
    <TabsVariantContext.Provider value={shape}>
      <TabsPrimitive.List
        data-slot="tabs-list"
        data-variant={shape}
        className={cn(tabsListVariants({ variant: shape }), className)}
        {...props}
      />
    </TabsVariantContext.Provider>
  )
}

// A trigger is 13 px at 400, the active one at 600 (the guide's weights are 400, 600 and 700);
// hover takes the hover fill. Disabled is opaque, never faded (CI §8): quiet text, no hover, the
// not-allowed cursor. The line's bar is a real border, so a Windows contrast theme keeps it
// (theme.css draws it in Highlight there).
const tabsTriggerVariants = cva(
  "text-muted-foreground hover:bg-accent hover:text-foreground text-dense data-[state=active]:text-foreground relative inline-flex items-center gap-1.5 whitespace-nowrap transition-colors data-[state=active]:font-semibold disabled:cursor-not-allowed disabled:bg-transparent disabled:text-muted-foreground group-data-[orientation=vertical]/tabs:w-full group-data-[orientation=vertical]/tabs:justify-start [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: cn(
          "flex-1 justify-center rounded-sm border border-transparent px-2 data-[state=active]:border-border data-[state=active]:bg-raised data-[state=active]:shadow-1",
          FOCUS_RING,
        ),
        line: cn(
          "data-[state=active]:bg-accent data-[state=active]:border-b-interaction -mb-px justify-center border-b-2 border-transparent px-2 group-data-[orientation=vertical]/tabs:mb-0 group-data-[orientation=vertical]/tabs:border-b-0 group-data-[orientation=vertical]/tabs:border-r-2 group-data-[orientation=vertical]/tabs:data-[state=active]:border-r-interaction",
          FOCUS_RING_INSET,
        ),
      },
    },
  },
)

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  )
}

/**
 * A tab's count, after its label: a quiet pill (a named deviation: counts are pills), the
 * number at 400 in tabular figures, always shown, a zero too. It is the exact count, so the tab's
 * name says it as the eye reads it ("Incidents 3"). Numbers stay neutral: an alarming count
 * says so in its label, never in a colour.
 */
function TabCount({ count, className }: { count: number; className?: string }) {
  const locale = useUiLocale()
  return (
    <span
      data-slot="tab-count"
      className={cn(
        "bg-background text-muted-foreground text-small rounded-pill inline-flex min-w-4 justify-center px-[5px] font-normal tabular-nums",
        className,
      )}
    >
      {formatCountIn(count, locale)}
    </span>
  )
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  // Radix makes the panel a tab stop (tabIndex 0), so it needs a visible focus.
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn("flex-1", FOCUS_RING_INSET, className)}
      {...props}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent, TabCount }
