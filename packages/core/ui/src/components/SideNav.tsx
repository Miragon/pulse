import { createContext, useContext, useId, type ComponentProps, type ReactNode } from "react"
import { Slot } from "radix-ui"
import { FOCUS_RING_INSET } from "../lib/focus-ring.js"
import { MICRO_LABEL } from "../lib/typography.js"
import { cn } from "../lib/utils.js"

export interface SideNavProps extends Omit<ComponentProps<"nav">, "aria-label" | "children"> {
  /** The landmark's name ("Pulse"): a page may hold more than one navigation. */
  ariaLabel: string
  /** Its groups ({@link SideNavGroup}) and lists ({@link SideNavList}), top to bottom. */
  children: ReactNode
}

/**
 * A side navigation, an app's frame in the editors' look: a `nav` landmark named by `ariaLabel`
 * around lists of {@link SideNavItem}s, each a row of the row height (28 px compact, 40 px
 * comfortable) that the reader reaches with Tab and opens with Enter, a link where it opens an
 * address (`asChild` around the router's `<a href>`, so Ctrl or Cmd+click and a middle click open
 * a new tab). The current place is `aria-current="page"`: the hover fill, 600 and a 2 px edge on
 * its left in `--interaction`, which `theme.css` draws in Highlight under forced colours. It lays
 * out nothing around it: its column, its width and its scroll are the page's.
 */
export function SideNav({ ariaLabel, className, children, ...props }: SideNavProps) {
  return (
    <nav
      data-slot="side-nav"
      aria-label={ariaLabel}
      className={cn("flex min-w-0 flex-col gap-3", className)}
      {...props}
    >
      {children}
    </nav>
  )
}

export interface SideNavGroupProps {
  /** The group's caption above it, which names it (an environment, "Engines", "Boards"). */
  label: ReactNode
  /** Its lists and nested groups. */
  children: ReactNode
  className?: string
}

/**
 * A named group of the navigation: its caption (13 px at 600, quiet) above its lists, which a
 * screen reader hears as the group's name. A group may hold groups (the engines of each
 * environment under "Engines").
 */
export function SideNavGroup({ label, children, className }: SideNavGroupProps) {
  const id = useId()
  return (
    <div
      role="group"
      aria-labelledby={id}
      data-slot="side-nav-group"
      className={cn("flex min-w-0 flex-col", className)}
    >
      <p
        id={id}
        className={cn(MICRO_LABEL, "text-muted-foreground px-gutter py-1 [overflow-wrap:anywhere]")}
      >
        {label}
      </p>
      {children}
    </div>
  )
}

/** How deep an item sits: 0 for the navigation's own items, 1 for an item's nested ones. */
const DepthContext = createContext(0)

export interface SideNavListProps extends Omit<ComponentProps<"ul">, "children"> {
  /** Its items, each a {@link SideNavItem}. */
  children: ReactNode
}

/** A list of items; inside an item (its `nested`), its items indented under the item's label. */
export function SideNavList({ className, children, ...props }: SideNavListProps) {
  return (
    <ul data-slot="side-nav-list" className={cn("flex min-w-0 flex-col", className)} {...props}>
      {children}
    </ul>
  )
}

/**
 * The item's look: a row of the row height, 13 px in the foreground with a 16 px icon, the hover
 * fill; the current one on that fill at 600 with a real 2 px border on its left in
 * `--interaction` (transparent on the others, so no item moves): the edge a line of Pulse's
 * languages starts at. The padding beside it counts the border, so the icons line up with the
 * captions; a nested item's icon lines up with its parent's label.
 */
const SIDE_NAV_ITEM = cn(
  "text-dense text-foreground hover:bg-accent min-h-row pr-gutter flex min-w-0 items-center gap-2 border-l-2 border-transparent py-1 transition-colors [overflow-wrap:anywhere]",
  "aria-[current=page]:bg-accent aria-[current=page]:border-l-interaction aria-[current=page]:font-semibold",
  FOCUS_RING_INSET,
)

/** The left padding per depth: the gutter less the border, a nested item 24 px further in. */
const INDENT = ["pl-[calc(var(--gutter)-2px)]", "pl-[calc(var(--gutter)+1.5rem-2px)]"] as const

export type SideNavItemProps = Omit<ComponentProps<"a">, "children"> & {
  /** The page on screen: `aria-current="page"`, the fill, 600 and the 2 px edge. */
  current?: boolean
  /** A 16 px icon before the label (`<Icon icon={Server} />`), decorative. */
  icon?: ReactNode
  /** Quiet words at the item's end, part of its name ("boards only"). */
  note?: ReactNode
  /**
   * Renders the one child element (your router's `<a href>`) as the item: it takes the item's
   * look, `aria-current`, the icon and the note around its text.
   */
  asChild?: boolean
  /** The item's label, or with `asChild` the element that carries it. */
  children: ReactNode
  /** The item's own items below it, a {@link SideNavList} (an engine's sections). */
  nested?: ReactNode
}

/**
 * One item of a {@link SideNavList}: an `<a>` (by default, or your link with `asChild`) in the
 * look above, its label wrapping where it is longer than the row, never cut. Its `nested` list
 * follows it inside its list item, indented one step.
 */
export function SideNavItem({
  current = false,
  icon,
  note,
  asChild = false,
  className,
  children,
  nested,
  ...props
}: SideNavItemProps) {
  const depth = Math.min(useContext(DepthContext), INDENT.length - 1)
  const Comp = asChild ? Slot.Root : "a"
  return (
    <li className="flex min-w-0 flex-col">
      <Comp
        {...props}
        data-slot="side-nav-item"
        aria-current={current ? "page" : undefined}
        className={cn(SIDE_NAV_ITEM, INDENT[depth], className)}
      >
        {icon && (
          <span
            aria-hidden="true"
            className="text-muted-foreground inline-flex shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            {icon}
          </span>
        )}
        <Slot.Slottable>{children}</Slot.Slottable>
        {note && (
          <span data-slot="side-nav-note" className="text-muted-foreground ms-auto font-normal">
            {/* A comma for the name ("c8-dev, boards only"); the eye reads the gap. */}
            <span className="sr-only">, </span>
            {note}
          </span>
        )}
      </Comp>
      {nested && <DepthContext.Provider value={depth + 1}>{nested}</DepthContext.Provider>}
    </li>
  )
}
