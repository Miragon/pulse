import type { ComponentProps, ReactNode } from "react"
import { Slot } from "radix-ui"
import type { Count } from "../format/index.js"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { cn } from "../lib/utils.js"
import { TabCount } from "../primitives/tabs.js"

export interface NavTabsProps extends Omit<ComponentProps<"nav">, "aria-label" | "children"> {
  /** The landmark's name ("Cockpit sections"): a page may hold more than one navigation. */
  ariaLabel: string
  /** The items, each a {@link NavTab}. */
  children: ReactNode
}

/**
 * A navigation between a set of views (a cockpit's sections, a web app's pages) in the look of
 * the kit's line tabs: a `nav` landmark named by `ariaLabel` around a list of {@link NavTab}s,
 * each a link or a button the reader reaches with Tab and opens with Enter (a navigation, never a
 * tab list with arrow keys). It is at least a toolbar high and draws no rule of its own: put it in
 * a bar that draws one (a head's `border-b`, or `className="border-b"`), and the current item's
 * 2 px bar lands on that rule. Where the items do not fit, they wrap onto a further line, so every
 * item stays whole and reachable, never cut, hidden or scrolled out of sight.
 */
export function NavTabs({ ariaLabel, className, children, ...props }: NavTabsProps) {
  return (
    <nav
      data-slot="nav-tabs"
      aria-label={ariaLabel}
      className={cn("flex min-w-0 items-stretch", className)}
      {...props}
    >
      <ul className="min-h-toolbar -mb-px flex min-w-0 flex-wrap items-stretch">{children}</ul>
    </nav>
  )
}

/** The line tab's look (the `Tabs` line variant's) on `aria-current` instead of a tab's state. */
const NAV_TAB = cn(
  "text-dense text-muted-foreground hover:bg-accent hover:text-foreground inline-flex items-center gap-1.5 border-b-2 border-transparent px-2 whitespace-nowrap transition-colors",
  "aria-[current=page]:bg-accent aria-[current=page]:border-b-interaction aria-[current=page]:text-foreground aria-[current=page]:font-semibold",
  FOCUS_RING_INSET,
)

export type NavTabProps = Omit<ComponentProps<"button">, "children"> & {
  /** The view on screen: `aria-current="page"`, the hover fill, 600 and the 2 px bar. */
  current?: boolean
  /** A 16 px icon before the label (`<Icon icon={LayoutDashboard} />`), decorative. */
  icon?: ReactNode
  /** A count after the label as the kit's `TabCount`: a quiet pill, the count in the name. */
  count?: Count
  /**
   * Renders the one child element (`<a href>`, your router's link) as the item instead of a
   * button: it takes the item's look, `aria-current` and the icon and count around its text.
   */
  asChild?: boolean
  /** The item's label, or with `asChild` the element that carries it. */
  children: ReactNode
}

/**
 * One item of {@link NavTabs}, the kit's line tab (CI §8) as a link or a button: 13 px, the
 * quiet text, on the hover fill while hovered; the current one on that fill at 600 with a real
 * 2 px bottom border in `--interaction`, which `theme.css` draws in Highlight under forced
 * colours (the others' in Canvas), so the bar survives a Windows contrast theme. A button
 * (`type="button"`) by default; `asChild` makes your link the item.
 */
export function NavTab({
  current = false,
  icon,
  count,
  asChild = false,
  className,
  children,
  type,
  ...props
}: NavTabProps) {
  const Comp = asChild ? Slot.Root : "button"
  return (
    <li className="flex">
      <Comp
        {...props}
        type={asChild ? type : (type ?? "button")}
        data-slot="nav-tab"
        aria-current={current ? "page" : undefined}
        className={cn(NAV_TAB, className)}
      >
        {icon && (
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            {icon}
          </span>
        )}
        <Slot.Slottable>{children}</Slot.Slottable>
        {count !== undefined && <TabCount count={count} />}
      </Comp>
    </li>
  )
}
