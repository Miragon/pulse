import { createContext, useContext, useMemo, type ReactNode } from "react"
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

/** What a host adds to every {@link ViewBar} below it ({@link ViewBarSlots}). */
interface ViewBarSlotParts {
  /** The bar's first element, before the back button: a page's menu button, say. */
  readonly lead?: ReactNode
  /** Actions before the bar's own, in its one group: the Refresh a host's hidden head offered. */
  readonly actions?: ReactNode
}

const ViewBarSlotsContext = createContext<ViewBarSlotParts>({})

export interface ViewBarSlotsProps extends ViewBarSlotParts {
  children: ReactNode
}

/**
 * What a host adds to every view bar below it, without a prop on each: `lead`, the bar's first
 * element (a page that navigates itself hands its menu button, which opens its navigation), and
 * `actions` before the bar's own (a host that hides a view's head moves its Refresh there). A
 * provider inside another keeps what it does not set. Without one a bar shows its own parts alone,
 * as in a chat and the webview.
 */
export function ViewBarSlots({ lead, actions, children }: ViewBarSlotsProps) {
  const outer = useContext(ViewBarSlotsContext)
  const slots = useMemo<ViewBarSlotParts>(
    () => ({ lead: lead ?? outer.lead, actions: actions ?? outer.actions }),
    [lead, actions, outer],
  )
  return <ViewBarSlotsContext.Provider value={slots}>{children}</ViewBarSlotsContext.Provider>
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
  /**
   * The bar's first element, before the subject and its back button (a page's menu button);
   * default: the `lead` of the nearest {@link ViewBarSlots}. It shares the subject's line at every
   * width, so the title gives way beside it, and a lead the page hides at a width (`lg:hidden`)
   * takes no room there, nor its gap.
   */
  lead?: ReactNode
  /** Goes back in the host's history: draws the back button after the lead, before the rest. */
  onBack?: () => void
  /**
   * The back button's name and tooltip where it says where it goes ("Back to Invoice");
   * default: "Back".
   */
  backLabel?: string
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

/**
 * The actions' toolbar buttons show their labels again under 30rem, where the group has a line of
 * its own below the subject and room for the words: the kit's `Button` hides a toolbar label in a
 * bar under 36rem, so between 30 and 36rem, where the group shares its line with the title, they
 * stay icons. This group alone: a `Toolbar`'s or a `StatusStrip`'s buttons share their line at
 * every width and keep the 36rem rule. Each selector outranks the button's own (`:is(a,button)`
 * adds a type), so neither the label's `sr-only` nor the square padding holds here.
 */
const ACTIONS_LABELLED_ON_OWN_LINE = [
  "@max-[30rem]/bar:[&_:is(a,button):has(>svg)>[data-slot=button-label]]:not-sr-only",
  "@max-[30rem]/bar:[&_:is(a,button):has(>svg)>[data-slot=button-label]]:whitespace-nowrap",
  "@max-[30rem]/bar:[&_:is(a,button):has(>svg)]:px-2",
].join(" ")

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
      {/* No reserved width: a stamp that changes its words while it refreshes holds its own (the
          webview's live stamp); a plain "As of 14:32" takes only its text, so it stays on the
          actions' line instead of opening a line of its own. */}
      {freshness !== undefined && (
        <span
          data-slot="view-bar-freshness"
          className="inline-flex items-center justify-end gap-1.5 text-right whitespace-nowrap tabular-nums"
        >
          {freshness}
        </span>
      )}
    </div>
  )
}

/** The subject's basis in the bar's row (its own, or the line it shares with the lead): 20rem. */
const SUBJECT_BASIS = "flex-[1_1_20rem]"

/** The subject's grid: the row's basis alone, else the room beside the lead on their line. */
function subjectClassName(lead: ReactNode): string {
  return cn(
    "text-dense grid max-w-max min-w-min grid-cols-[auto_auto_minmax(6ch,max-content)_auto] items-center justify-start whitespace-nowrap",
    lead ? "flex-auto" : SUBJECT_BASIS,
  )
}

/**
 * The bar's start: the subject alone, or the lead and the subject on one line that never breaks
 * (the lead a flex item of its own, so one the page hides takes no room and no gap), which takes
 * the subject's place in the row. Without that line the row would break by the subject's 20rem
 * basis beside the lead, and a title that does not fit beside it on a phone would leave the lead
 * alone on a line instead of giving way.
 */
function BarStart({ lead, children }: { lead: ReactNode; children: ReactNode }) {
  if (!lead) return children
  return (
    <div
      data-slot="view-bar-start"
      className={cn("flex max-w-max min-w-min items-center gap-x-2.5", SUBJECT_BASIS)}
    >
      {lead}
      {children}
    </div>
  )
}

/**
 * The bar's lead (its own, else its host's) and its one group of actions, the host's first: none
 * where neither brings one.
 */
function useBarParts(lead: ReactNode, actions: ReactNode): { first: ReactNode; group: ReactNode } {
  const slots = useContext(ViewBarSlotsContext)
  const group =
    slots.actions || actions ? (
      <>
        {slots.actions}
        {actions}
      </>
    ) : undefined
  return { first: lead ?? slots.lead, group }
}

/**
 * A view's bar (the webview's context bar): 40 px high, its rule below included, on the card's
 * surface, the subject first (the host's lead, the back button, a 16 px icon, the title as the
 * bar's heading in 13 px at 600 and the state after it), then the facts in quiet 13 px text, the
 * actions as one group (a host's slots first) and, at the end, the access chip, the host's live
 * control and its freshness stamp. It keeps one line where it gets narrow: the title gives way first, cut with an ellipsis (its whole
 * text in its title) down to 20rem for the subject (about 10rem of title beside a state) or to 6ch
 * on a line of its own, and a toolbar button's label hides
 * visually under 36rem (its container is `bar`) and stays its name. Only a group that still has
 * no room moves onto a further line, never cut or hidden (WCAG 1.4.10: the facts hold ids and
 * links, the meta the host's controls), and under 30rem the actions and the meta start a line of
 * their own below the subject and its facts, where the actions' labels show again: a line of
 * their own has room for the words. The bar's height is its content's, 40 px at least.
 */
export function ViewBar({
  title,
  as: Heading = "h1",
  titleText,
  titleSuffix,
  lead,
  onBack,
  backLabel,
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
  const { first, group } = useBarParts(lead, actions)
  const backName = backLabel ?? viewBar.back
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
          way down to 6ch. With a lead, the line they share takes the basis, and the subject the
          room beside the lead.
        */}
        <BarStart lead={first}>
          <div data-slot="view-bar-subject" className={subjectClassName(first)}>
            {onBack && (
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={backName}
                title={backName}
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
        </BarStart>
        {facts && (
          <div
            data-slot="view-bar-facts"
            className="text-small text-muted-foreground flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-0.5"
          >
            {facts}
          </div>
        )}
        {(group || meta) && (
          <span aria-hidden="true" className="hidden h-0 basis-full @max-[30rem]/bar:block" />
        )}
        {group && (
          <div
            data-slot="view-bar-actions"
            className={cn("flex flex-wrap items-center gap-2", ACTIONS_LABELLED_ON_OWN_LINE)}
          >
            {group}
          </div>
        )}
        {meta && <BarMeta access={access} live={live} freshness={freshness} />}
      </div>
    </header>
  )
}
