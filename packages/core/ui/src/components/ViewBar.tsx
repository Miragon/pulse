import type { ReactNode } from "react"
import { ArrowLeft, Eye, Pencil } from "lucide-react"
import { Icon } from "../kit/icon.js"
import { BAR_CONTAINER, BAR_INSET } from "../lib/bar.js"
import { cn } from "../lib/utils.js"
import { useUiMessages } from "../locale/locale-provider.js"
import { Button } from "../primitives/button.js"

/** Heading element of a {@link ViewBar} title. */
export type ViewBarHeadingLevel = "h1" | "h2" | "h3" | "h4" | "h5" | "h6"

/** What the view may do on its engine: the access chip's state and the host's note on it. */
export interface ViewBarAccess {
  /** Whether the view may write to the engine. */
  writable: boolean
  /** The host's words on what the view may do there, shown as the chip's title. */
  note?: string
}

export interface ViewBarProps {
  /** What the view shows, the bar's heading: one line, cut with an ellipsis where it has no room. */
  title: ReactNode
  /** Heading element of the title. Default `"h1"`: the view is the page. */
  as?: ViewBarHeadingLevel
  /** The whole title as its tooltip, when `title` is no plain text. */
  titleText?: string
  /** Inside the heading after the title (a version chip). */
  titleSuffix?: ReactNode
  /** Goes back in the host's history: draws the back button before everything else. */
  onBack?: () => void
  /** A 16 px icon naming what the view shows (`<Icon icon={Workflow} />`), decorative. */
  icon?: ReactNode
  /** The state of the thing shown, after the title (a `StateLabel` or a `StatusBadge`). */
  badge?: ReactNode
  /** Facts about it in quiet 13 px text: a key, a version, a `CopyableId`. */
  facts?: ReactNode
  /** The view's actions, one group (`Button` toolbar or sm), ordered as the house rules say. */
  actions?: ReactNode
  /** The access chip: whether the view only reads from the engine or may write to it. */
  access?: ViewBarAccess
  /** The host's live control (pause and resume live updates). */
  live?: ReactNode
  /** The host's freshness stamp ("As of 14:32"), right-aligned in tabular figures. */
  freshness?: ReactNode
  className?: string
}

function AccessChip({ access }: { access: ViewBarAccess }) {
  const { viewBar } = useUiMessages()
  return (
    <span
      data-slot="view-bar-access"
      title={access.note}
      className="inline-flex items-center gap-1.5"
    >
      <Icon
        icon={access.writable ? Pencil : Eye}
        className={access.writable ? "text-link" : undefined}
      />
      {access.writable ? viewBar.writable : viewBar.readOnly}
    </span>
  )
}

function BarMeta({ access, live, freshness }: Pick<ViewBarProps, "access" | "live" | "freshness">) {
  const host = live !== undefined || freshness !== undefined
  return (
    <div
      data-slot="view-bar-meta"
      className="text-small text-muted-foreground ml-auto flex min-w-0 flex-wrap items-center justify-end gap-x-2.5 gap-y-1"
    >
      {access && <AccessChip access={access} />}
      {access && host && <span aria-hidden="true" className="bg-border h-4 w-px" />}
      {live}
      {freshness !== undefined && (
        <span
          data-slot="view-bar-freshness"
          className="inline-flex min-w-[24ch] items-center justify-end gap-1.5 text-right tabular-nums"
        >
          {freshness}
        </span>
      )}
    </div>
  )
}

/**
 * A view's bar (the webview's context bar): 40 px high, its rule below included, on the card's
 * surface, the subject first (the back button, a 16 px icon, the title as the bar's heading in
 * 13 px at 600 and the state after it), then the facts in quiet 13 px text, the actions as one
 * group and, at the end, the access chip, the host's live control and its freshness stamp. It
 * keeps one line where it gets narrow: the title gives way first, cut with an ellipsis (its whole
 * text in its title) down to 20rem for the subject (about 10rem of title beside a state) or to 6ch
 * on a line of its own, and a toolbar button's label hides
 * visually under 36rem (its container is `bar`) and stays its name. Only a group that still has
 * no room moves onto a further line, never cut or hidden (WCAG 1.4.10: the facts hold ids and
 * links, the meta the host's controls), and under 30rem the actions and the meta start a line of
 * their own below the subject and its facts. The bar's height is its content's, 40 px at least.
 */
export function ViewBar({
  title,
  as: Heading = "h1",
  titleText,
  titleSuffix,
  onBack,
  icon,
  badge,
  facts,
  actions,
  access,
  live,
  freshness,
  className,
}: ViewBarProps) {
  const { viewBar } = useUiMessages()
  const meta = access !== undefined || live !== undefined || freshness !== undefined
  return (
    <header
      data-slot="view-bar"
      className={cn(
        BAR_CONTAINER,
        "bg-card border-border min-h-bar flex min-w-0 flex-col justify-center border-b",
        className,
      )}
    >
      <div className={cn("flex flex-wrap items-center gap-x-4 gap-y-1 py-1", BAR_INSET)}>
        {/*
          The subject's columns: the back button, the icon and the state at their own width (an
          empty one takes none, its gap is the item's margin), the title between them from 6ch up
          to its whole text. A grid, since its minimum then counts the title's 6ch (a flex row
          would count the whole title). Its basis is 20rem, so beside a state the title keeps
          about 10rem before the facts move onto a line of their own; alone on a line it gives
          way down to 6ch.
        */}
        <div
          data-slot="view-bar-subject"
          className="text-dense grid max-w-max min-w-min flex-[1_1_20rem] grid-cols-[auto_auto_minmax(6ch,max-content)_auto] items-center justify-start whitespace-nowrap"
        >
          {onBack && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={viewBar.back}
              onClick={onBack}
              className="col-start-1 me-2.5"
            >
              <Icon icon={ArrowLeft} />
            </Button>
          )}
          {icon && (
            <span
              aria-hidden="true"
              className="text-muted-foreground col-start-2 me-2.5 inline-flex [&_svg:not([class*='size-'])]:size-4"
            >
              {icon}
            </span>
          )}
          <Heading
            title={titleText ?? (typeof title === "string" ? title : undefined)}
            className="text-dense text-foreground col-start-3 flex min-w-[6ch] items-center gap-1.5 font-semibold"
          >
            <span className="min-w-0 truncate">{title}</span>
            {titleSuffix}
          </Heading>
          {badge && <span className="col-start-4 ms-2.5 inline-flex items-center">{badge}</span>}
        </div>
        {facts && (
          <div
            data-slot="view-bar-facts"
            className="text-small text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5"
          >
            {facts}
          </div>
        )}
        {(actions || meta) && (
          <span aria-hidden="true" className="hidden h-0 basis-full @max-[30rem]/bar:block" />
        )}
        {actions && (
          <div data-slot="view-bar-actions" className="flex flex-wrap items-center gap-2">
            {actions}
          </div>
        )}
        {meta && <BarMeta access={access} live={live} freshness={freshness} />}
      </div>
    </header>
  )
}
