import { createContext, useContext, type ReactNode } from "react"
import type * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Tabs as TabsPrimitive } from "radix-ui"

import type { Count } from "../format/index.js"
import { countText, countWords } from "../lib/count-words.js"
import { FOCUS_RING, FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"
import { useUiLocale, useUiMessages } from "../locale/locale-provider.js"

type TabsVariant = "default" | "line"

/** The list's variant, which its triggers take their shape from. */
const TabsVariantContext = createContext<TabsVariant>("default")

type TabsOrientation = "horizontal" | "vertical"

/** The tabs' orientation: a horizontal line list sits in its bar and scrolls inside it. */
const TabsOrientationContext = createContext<TabsOrientation>("horizontal")

function Tabs({
  className,
  orientation = "horizontal",
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsOrientationContext.Provider value={orientation}>
      <TabsPrimitive.Root
        data-slot="tabs"
        data-orientation={orientation}
        orientation={orientation}
        className={cn("group/tabs flex gap-2 data-[orientation=horizontal]:flex-col", className)}
        {...props}
      />
    </TabsOrientationContext.Provider>
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

/**
 * The bar a list sits in: always for a horizontal line, else with an aside after the list. The
 * line's frame (its height, its rule) moves from the list onto the bar, and the list takes the
 * room an aside leaves.
 */
const TABS_BAR = {
  default: "inline-flex items-center gap-2",
  line: "flex w-full items-stretch gap-2 border-b min-h-toolbar",
} as const

/**
 * A line list in its bar stays one line and scrolls inside itself where its tabs need more room
 * than the bar has, its scrollbar hidden: a tab that takes the focus (the arrows, a click on a cut
 * one) scrolls into view, so every tab stays reachable by keyboard, and a swipe or a wheel with
 * Shift scrolls it. It reaches 1 px over the bar's rule, so the open tab's 2 px bar covers the rule
 * as it does outside a scroll container; the tabs scroll to the bar's edges, the list's own sides
 * inside the scroll.
 */
const LIST_IN_BAR = {
  default: "",
  line: "min-w-0 flex-1 -mb-px border-b-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] group-data-[orientation=horizontal]/tabs:min-h-0",
} as const

function TabsList({
  className,
  variant = "default",
  aside,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> &
  VariantProps<typeof tabsListVariants> & {
    /**
     * What sits at the bar's end, after the tabs and outside the tab list (a legend's button, a
     * count of the whole): the list keeps tabs only. With it, and always for a horizontal line,
     * the list sits in a bar and `className` goes to the bar.
     */
    aside?: ReactNode
  }) {
  const shape = variant ?? "default"
  const orientation = useContext(TabsOrientationContext)
  const beside = aside !== undefined
  const inBar = beside || (shape === "line" && orientation === "horizontal")
  const list = (
    <TabsPrimitive.List
      data-slot="tabs-list"
      data-variant={shape}
      className={cn(
        tabsListVariants({ variant: shape }),
        inBar ? LIST_IN_BAR[shape] : className,
        // Beside an aside the bar keeps the side after it; alone the list scrolls to both edges.
        shape === "line" && beside && "pr-0",
      )}
      {...props}
    />
  )
  return (
    <TabsVariantContext.Provider value={shape}>
      {inBar ? (
        <div
          data-slot="tabs-bar"
          data-variant={shape}
          className={cn(TABS_BAR[shape], beside && shape === "line" && "pr-gutter", className)}
        >
          {list}
          {beside && (
            <div data-slot="tabs-aside" className="flex shrink-0 items-center gap-1">
              {aside}
            </div>
          )}
        </div>
      ) : (
        list
      )}
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
          "data-[state=active]:bg-accent data-[state=active]:border-b-interaction justify-center border-b-2 border-transparent px-2 group-data-[orientation=vertical]/tabs:border-b-0 group-data-[orientation=vertical]/tabs:border-r-2 group-data-[orientation=vertical]/tabs:data-[state=active]:border-r-interaction",
          FOCUS_RING_INSET,
        ),
      },
    },
  },
)

/**
 * Scrolls a line list just enough to show the whole of its tab that took the focus, with the
 * list's own side beside it: the browser leaves a tab half in view where it is, so an arrow or a
 * click on a cut tab would not reveal it. The list alone scrolls, never the page around it.
 */
function revealInList(tab: HTMLElement): void {
  const list = tab.closest<HTMLElement>('[data-slot="tabs-list"]')
  if (!list || list.scrollWidth <= list.clientWidth) return
  const style = getComputedStyle(list)
  const shown = list.getBoundingClientRect()
  const start = shown.left + (Number.parseFloat(style.paddingLeft) || 0)
  const end = shown.right - (Number.parseFloat(style.paddingRight) || 0)
  const own = tab.getBoundingClientRect()
  if (own.left < start) list.scrollLeft -= start - own.left
  else if (own.right > end) list.scrollLeft += own.right - end
}

function TabsTrigger({
  className,
  onFocus,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const variant = useContext(TabsVariantContext)
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      data-variant={variant}
      className={cn(tabsTriggerVariants({ variant }), className)}
      onFocus={(event) => {
        onFocus?.(event)
        if (variant === "line") revealInList(event.currentTarget)
      }}
      {...props}
    />
  )
}

/**
 * A tab's count, after its label: a quiet pill (a named deviation: counts are pills), the
 * number at 400 in tabular figures, always shown, a zero too. It is the count as `formatCount`
 * writes it (`1,234`; a lower bound a capped read vouches for `≥ 2,000`; unknown `—`), and the
 * tab's name says it in words ("Incidents 1,234", "Jobs at least 2,000", "Jobs count unknown"),
 * both in the kit's locale, so the number is grouped in the language of its words. Numbers stay
 * neutral: an alarming count says so in its label, never in a colour.
 */
function TabCount({ count, className }: { count: Count; className?: string }) {
  const words = useUiMessages().count
  const locale = useUiLocale()
  return (
    <span
      data-slot="tab-count"
      className={cn(
        "bg-background text-muted-foreground text-small rounded-pill inline-flex min-w-4 justify-center px-[5px] font-normal tabular-nums",
        className,
      )}
    >
      <span aria-hidden="true">{countText(count, locale)}</span>
      <span className="sr-only">{countWords(count, words, locale)}</span>
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
