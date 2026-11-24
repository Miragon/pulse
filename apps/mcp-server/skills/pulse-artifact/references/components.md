<!-- Generated from the packages' declarations by apps/mcp-server/test/artifact-components.ts. Do not edit: run pnpm --fail-if-no-match --filter @miragon/pulse-mcp-server golden:update. -->

# Components and helpers

The props and signatures of the names a page on Pulse composes, read from the declarations of the
packages at the version this plugin carries. Each block is TypeScript: `declare function` for a
component (its one argument is its props) or a function, `interface` and `type` for data. A prop
written `a?: T` may be left out; where two props come together, the block shows the alternatives
as a union. Deprecated props are left out, and a component that passes the rest on to its element
ends with a comment saying so.

Every type of the kit a block names has a block of its own, or, where its package keeps it to
itself, is spelled out at the prop that uses it. These few stay names, since a page needs no more
of them:

- `UiMessagesOverride`: the kit's own words per part, which a page leaves as they are
- `UiMessages`: the kit's words in the viewer's language, as `useUiMessages()` returns them
- `DataTableSelection`: a selection column, as `rowSelection` builds it
- `ColumnSizing`: columns a reader sizes by dragging, as `useColumnSizing` returns it
- `BpmnElementRegistry`: bpmn-js's element registry, `viewer.get("elementRegistry")`
- `BpmnEventBus`: bpmn-js's event bus, `viewer.get("eventBus")`
- `FitRect`: a box `{ x, y, width, height }` in diagram units, which pulse-ui keeps to itself

Import each name from the entry its section names, never from a `dist/` path.

## @miragon/pulse-ui

```ts
import {
  WidgetHeader,
  FreshnessStamp,
  Facts,
  type Fact,
  VersionChip,
  SectionHeading,
  PanelGrid,
  Panel,
  SectionStateGroup,
  SectionState,
  type SectionStateValue,
  type SectionFailure,
  describePageError,
  type PageError,
  type PageErrorCode,
  type DescribePageErrorOptions,
  StatusStrip,
  type StatusStripAction,
  KpiGrid,
  type KpiGridHeader,
  type KpiCell,
  KpiGridSkeleton,
  type ToneName,
  type ToneVariant,
  CountFigure,
  CountBadge,
  StateLabel,
  DataTable,
  type DataTableColumn,
  type RowActivation,
  TableEmptyState,
  NamedId,
  ErrorState,
  Skeleton,
  Button,
  Icon,
  LocaleProvider,
  useLocale,
  createUseT,
  type Translate,
  type T,
  cn,
} from "@miragon/pulse-ui"
```

### WidgetHeader

```ts
/**
 * The header at the top of a widget. A view's header is its `ViewBar` (the default): the title
 * as the bar's heading in 13 px at 600, the state after it, the facts, the actions and, at its
 * end, when the numbers were read (`freshness`), wrapping where it gets narrow. At app level (`size="app"`, a landing, all engines) it is the hero: the
 * state above a 28 px title at 700, the meta row under it and the actions on the right. Use once
 * per widget surface.
 */
declare function WidgetHeader(props: {
  /** The widget title. */
  title: ReactNode
  /**
   * Heading element of the title. Default `"h1"`: the widget is the page.
   * Pick the level that keeps ONE outline per view: below a host toolbar's
   * title (an h2, say) use `"h3"`, inside a composed view under its own
   * heading one level below it. The size follows `size`, not the level.
   */
  as?: "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  /**
   * `"default"` and `"detail"`: a view's header, its `ViewBar` (the title as the bar's 13 px
   * heading at 600, the chrome title of the guide); the two draw the same bar. `"app"`: the
   * app-level title (a landing, all engines), 28 px at 700 above its meta row.
   */
  size?: "default" | "detail" | "app"
  /** Inline after the title inside the heading (e.g. a version chip). */
  titleSuffix?: ReactNode
  /** The state in words: a `StatusBadge` or a `StateLabel`, after the title in a view's bar. */
  badge?: ReactNode
  /** Facts about the subject (a live pill, counts, an id): the bar's facts, in quiet 13 px text. */
  sub?: ReactNode
  /** The view's actions (buttons, drill controls), one group. */
  actions?: ReactNode
  /**
   * When the view's numbers were read, at the bar's end (`ViewBar`'s freshness slot): widget-shell's
   * `FreshnessStamp`, "As of 14:32" without seconds, the whole instant in its title. Never a fact
   * among the facts. A view's bar only: the app-level hero shows none.
   */
  freshness?: ReactNode
  className?: string
}): JSX.Element
```

### FreshnessStamp

```ts
/**
 * When a view's or a page's numbers were read, for the freshness slot of its bar (`WidgetHeader`'s
 * and `ViewBar`'s `freshness`): a clock and "As of 14:32", the time without seconds and its day
 * before it on another day (`formatClock`), the whole instant in its title (`formatInstant`), in
 * the kit's words of the nearest `LocaleProvider`. The board's form, one for every view: at the
 * bar's end in tabular figures, never a fact and never a "Live" pill. Nothing for no time or one
 * that does not parse, never a guess. A page that reads several sources stamps the oldest read.
 */
declare function FreshnessStamp(props: {
  /** When the numbers were read: an ISO timestamp or a `Date`. */
  readonly at: string | Date | null | undefined
}): null | JSX.Element
```

### Facts

```ts
/**
 * Facts about one thing (the webview's incident facts) as a description list on a two-column
 * grid: each term quiet in 13 px, its value in the foreground beside it, the two on one baseline
 * (a value with a 24 px copy button centres its text in it, and the term follows). A value wraps
 * anywhere rather than widen the view (an exception, a long id), several parts of one value wrap
 * as a row 4 px apart, and a `CopyableId` in it shows its copy button always.
 */
declare function Facts(props: { facts: readonly Fact[]; className?: string }): JSX.Element
```

### Fact

```ts
/** One fact of a Facts list. */
interface Fact {
  /** What the value is ("Root cause", "Job"), the term. */
  label: ReactNode
  /** The value: text, a `CopyableId`, a link. */
  value: ReactNode
  /** A technical value (a code, an exception, an expression): monospace. */
  mono?: boolean
  /** The value the eye goes to first (a root cause): at 600. */
  emphasis?: boolean
  /** A stable React key; default: the label's text, else its place. */
  id?: string
}
```

### VersionChip

```ts
/**
 * A version as a quiet chip ("v3"): mono caption text on the ground with a line edge, the badge's
 * 20 px height, so it sits in a 28 px table row as in a view's bar.
 */
declare function VersionChip(props: { version: string | number; className?: string }): JSX.Element
```

### SectionHeading

```ts
/**
 * Section title row: a small semibold heading with an optional muted hint or control on the
 * right. Use to label a block inside a widget body (e.g. a list or sub-table) without the visual
 * weight of a full card header. The title is the compact section title of every Pulse UI, the
 * webview's: 13 px at 600 in the foreground (MICRO_LABEL, normal case); the hint stays
 * quiet. `as` names its level in the view's outline at every call (a section's `h2`, an `h3`
 * under it, a card's caption a `"span"`), so screen readers can jump between a view's sections
 * and every section title has one look whatever its level; `text-section` (21 px) is only for a
 * dialog's title and a KPI figure. Where the row is short of room the hint moves under the title,
 * never cut.
 */
declare function SectionHeading(props: {
  /** The section title. */
  title: ReactNode
  /** Optional muted hint shown on the right (e.g. a count or last-updated note). */
  hint?: ReactNode
  /** Right-aligned slot that overrides `hint` when set (e.g. a control). */
  trailing?: ReactNode
  /**
   * The title's element, which every call names: a heading at the section's level of the view's
   * outline (`h2` for a block of the view, `h3` under it), or `"span"` for a caption inside a card
   * that is no section of its own, outside the outline.
   */
  as: "h2" | "h3" | "h4" | "h5" | "h6" | "span"
  /** The title's id, for the section's `aria-labelledby`. */
  id?: string
  /** Classes for the row, a margin other than the default 12 px below it (`mb-2`, `mb-0`). */
  className?: string
}): JSX.Element
```

### PanelGrid

```ts
/**
 * A dashboard's rows of panels: one column below 600 px of the grid's own width (a phone, a
 * narrow host), `columns` side by side where it has the room, the panels of a row as tall as the
 * tallest, so their ends line up. The gap is the density's section gap (12 px, 16 px on touch).
 * Columns follow the grid's own width, so a grid inside a narrow frame stacks as on a phone.
 */
declare function PanelGrid(props: {
  /**
   * How many panels stand side by side where the grid has the room: 2 (default) from 600 px of
   * its own width, 3 from 900 px (2 between); below 600 px always one.
   */
  readonly columns?: 1 | 2 | 3
  /** The panels (`Panel`), one per section. */
  readonly children: ReactNode
  readonly className?: string
}): JSX.Element
```

### Panel

```ts
/**
 * One section of a dashboard: a card of the compact look (the card's surface, a 1 px line, the
 * md radius, the density's gutter inside) named by its `SectionHeading`, its content below. A
 * `section` labelled by its title, so it is a landmark a screen reader lists; with an `id` it
 * takes the focus a page moves to it.
 */
declare function Panel(props: {
  /** The section's title. */
  readonly title: ReactNode
  /** The title's element. Default `"h2"`: a section of the page under its `h1`. */
  readonly as?: "h2" | "h3" | "h4" | "h5" | "h6"
  /** The quiet note beside the title: the scope its numbers span ("all versions"). */
  readonly hint?: ReactNode
  /** A control at the title's end (a legend, a switch), after the hint. */
  readonly trailing?: ReactNode
  /** The section's id: an anchor to scroll to, and a place the page can move the focus to. */
  readonly id?: string
  /** Spans the whole row of its `PanelGrid` (a diagram, a wide table). */
  readonly wide?: boolean
  readonly className?: string
  readonly children: ReactNode
}): JSX.Element
```

### SectionStateGroup

```ts
/**
 * The sections of a page that say a shared failure once: of the `SectionState`s under it that
 * fail with the same words, the first in the document shows the failure, the others a quiet line
 * that they were not read for the same reason, and the first one's Try again reads all of them
 * again. Without a group every section says its own failure.
 */
declare function SectionStateGroup(props: {
  /** The page's sections, at any depth. */
  readonly children: ReactNode
}): JSX.Element
```

### SectionState

```ts
/**
 * One section's read on a dashboard, the rendering half of whatever reads it: the skeleton while
 * the first read runs (after 400 ms, its room held before), the content once read, `empty` for a
 * read that found nothing, and a failure in the kit's status box with the raw text under Details
 * and Try again unless it is `permanent`. A read that fails after a good one keeps its data on
 * screen with the failure inline above it; a read over data on screen marks the region busy and
 * keeps the data. Under a SectionStateGroup a failure several sections share is said once.
 * Every word comes from the kit's catalogs or from `state.error`.
 */
declare function SectionState<T>(props: {
  readonly state: SectionStateValue<T>
  /** Reads the section again: the failure's Try again (none for a `permanent` one). */
  readonly onRetry: () => void
  /** The section's skeleton, in the geometry of the loaded content (default: a 96 px block). */
  readonly skeleton?: ReactNode
  /** What a read that found nothing shows (`TableEmptyState`, `EmptyState`). */
  readonly empty?: ReactNode
  /** Whether read data counts as nothing found, so `empty` shows. Default: `null` or `[]`. */
  readonly isEmpty?: (data: T) => boolean
  /** The failure's title element. Default `"p"`: the section's own heading stays its one. */
  readonly errorTitleAs?: "h1" | "h2" | "h3" | "h4" | "p"
  readonly className?: string
  /** The loaded content. */
  readonly children: (data: T) => ReactNode
}): JSX.Element
```

### SectionStateValue

```ts
/** A section's read as `SectionState` shows it. */
interface SectionStateValue<T> {
  /**
   * A read runs: over data or a failure on screen the region turns busy and they stay. Without
   * either the section waits for its first read whatever this says.
   */
  readonly loading?: boolean
  /** The last read's failure in words (`describePageError`, your own); none after a good read. */
  readonly error?: SectionFailure | null
  /**
   * The data of the last good read, kept while a later read runs or fails: `undefined` before
   * the first good read, `null` for a read that found nothing.
   */
  readonly data?: T | null
}
```

### SectionFailure

```ts
/**
 * A failure in words, as `SectionState` and a page's own `ErrorState` show it: what happened,
 * what you can do, the raw text for "Details" and whether a retry can help.
 */
interface SectionFailure {
  /** What happened, in plain words; never the raw text. */
  readonly title: string
  /** What you can do. */
  readonly hint?: string
  /** The raw reason, collapsed under "Details". */
  readonly details?: string
  /** A refusal no retry changes: its state offers no Try again, its hint names the way out. */
  readonly permanent?: boolean
}
```

### describePageError

```ts
/**
 * A page's failed call in the kit's words: what happened and what you can do per code, the raw
 * text only under "Details", and `permanent` where Try again cannot help. A code the type does
 * not know (an untyped transport) is worded as `tool_error`, never thrown.
 */
declare function describePageError(
  error: {
    readonly code:
      | "needs_reauth"
      | "not_connected"
      | "not_allowed"
      | "approval_required"
      | "unavailable"
      | "tool_error"
    /** The raw text of the failure (the transport's message, the server's error text). */
    readonly detail?: string | null
  },
  props: {
    /**
     * The kit's catalog in the viewer's language: `useUiMessages()` in a component,
     * `resolveUiMessages(locale)` outside one.
     */
    readonly messages: UiMessages
    /** What the page calls its way to Pulse, the name of the viewer's connector. Default "Pulse". */
    readonly connector?: string
    /**
     * Where the viewer manages that connection, a phrase the hint puts after its name as it is
     * ("in claude.ai, in Settings under Connectors"). Default: none, the hint names no place.
     */
    readonly place?: string
  },
): {
  /** What happened, in plain words; never the raw text. */
  readonly title: string
  /** What you can do. */
  readonly hint?: string
  /** The raw reason, collapsed under "Details". */
  readonly details?: string
  /** A refusal no retry changes: its state offers no Try again, its hint names the way out. */
  readonly permanent?: boolean
}
```

### PageError

```ts
/** A failed call of a page: its code and the raw text behind it, shown under "Details". */
interface PageError {
  readonly code:
    | "needs_reauth"
    | "not_connected"
    | "not_allowed"
    | "approval_required"
    | "unavailable"
    | "tool_error"
  /** The raw text of the failure (the transport's message, the server's error text). */
  readonly detail?: string | null
}
```

### PageErrorCode

```ts
/**
 * The page error vocabulary: why a call of a page outside a host gave no data, as one code per
 * reason, so a page maps its transport's errors once (a claude.ai artifact its runtime's
 * refusals, a page of your own its fetch) and the kit words them the same everywhere.
 *
 * - `needs_reauth`: the sign-in of the page's connection ran out, the viewer has to reconnect
 * - `not_connected`: the viewer has no connection of the name the page calls, or has to pick one
 * - `not_allowed`: the page may not call the tool it needs (its declared tools leave it out, or
 *   a policy of the viewer's organization blocks it); no retry changes that
 * - `approval_required`: the viewer has not approved the page's access yet
 * - `unavailable`: the connection or the server does not answer
 * - `tool_error`: the call reached the server and failed there, the engine's error or the tool's
 *   own; a page that can classify the server's text (widget-shell's `describeError`) words it
 *   with that instead
 */
type PageErrorCode =
  | "needs_reauth"
  | "not_connected"
  | "not_allowed"
  | "approval_required"
  | "unavailable"
  | "tool_error"
```

### DescribePageErrorOptions

```ts
/** What `describePageError` words a failure with: the catalog, the transport's name and place. */
interface DescribePageErrorOptions {
  /**
   * The kit's catalog in the viewer's language: `useUiMessages()` in a component,
   * `resolveUiMessages(locale)` outside one.
   */
  readonly messages: UiMessages
  /** What the page calls its way to Pulse, the name of the viewer's connector. Default "Pulse". */
  readonly connector?: string
  /**
   * Where the viewer manages that connection, a phrase the hint puts after its name as it is
   * ("in claude.ai, in Settings under Connectors"). Default: none, the hint names no place.
   */
  readonly place?: string
}
```

### StatusStrip

```ts
/**
 * A notice docked under a view's bar (the webview's strip), never a floating card: one line on
 * the tone's status surface with a rule in the tone below (2 px in high contrast, CanvasText in
 * forced colours), without the guide's 4 px edge (a named deviation): the tone's 16 px icon, the
 * title at 600, the detail after it, cut first where the line runs out (its whole text in the
 * title) and wrapping onto a second line under 30rem instead, and the actions as 24 px buttons.
 * Its message is a live region, `alert` for danger and `status` otherwise, and the actions sit
 * outside it: it announces when it appears and when its words change, never on a re-render or
 * when an action turns busy. A raw reason (`details`) waits behind a Details button and opens
 * under the line, so the strip stays one line until you ask for it.
 */
declare function StatusStrip(props: {
  tone: "danger" | "warning" | "info"
  /** What happened, in words: it never gives way to the detail. */
  title: string
  /** The rest of the message: on one line it is cut first, under 30rem it wraps instead. */
  detail?: string
  actions?: readonly StatusStripAction[]
  /**
   * The raw reason behind the words (an engine's own text): collapsed behind a Details button
   * before the actions, shown under the line in small mono once opened, outside the live region.
   */
  details?: string
  /** The Details button's words; default: the kit's "Details". */
  detailsLabel?: string
  /** Replaces the tone's icon (CircleX, TriangleAlert, Info). */
  icon?: LucideIcon
  className?: string
}): JSX.Element
```

### StatusStripAction

```ts
/** One action of a StatusStrip: a 24 px button whose label hides visually in a narrow strip. */
interface StatusStripAction {
  /** The action's words, its name. */
  label: string
  /**
   * A 16 px icon before the label; with it the label may collapse to the icon in a narrow strip.
   */
  icon?: LucideIcon
  onClick: () => void
  /**
   * While the action runs: its words for it ("Retrying…"). The button then shows a spinner and
   * refuses a press (`aria-disabled`), keeping the focus where it is.
   */
  busyLabel?: string
  /** Not available now: announced as dimmed, still reachable (`aria-disabled`). */
  disabled?: boolean
}
```

### KpiGrid

```ts
/**
 * A row of headline metrics, the canonical way to show KPIs in a widget
 * (replaces the single-metric KPICard). Compact: 12 px inside each tile, the
 * caption 4 px above a 21 px figure at 600. Cells flow as columns (1–6), falling
 * back to 2 columns in narrow frames. Every tile is neutral (invariant 6): no
 * tint, no coloured dot, the figure in the foreground; a count that alarms is
 * the value's `CountFigure`, its tone's icon of its own shape before it and its
 * words for a screen reader. A clickable cell is a button whose accessible name
 * is its visible label and value; `actionHint` describes what the click does.
 */
declare function KpiGrid(props: {
  /** The metric cells, flowed as columns (1–6; more wrap onto further rows). */
  cells: KpiCell[]
  /** Wrap the strip in a bordered card with an optional group `header`. Default `false`. */
  boxed?: boolean
  /** Group header row above the strip, usually with `boxed`. */
  header?: KpiGridHeader
  /** Names the group of metrics (`role="group"`); omit when a heading right above names it. */
  ariaLabel?: string
  className?: string
}): JSX.Element
```

### KpiGridHeader

```ts
interface KpiGridHeader {
  /** Group label of the strip's header row (13 px at 600, normal case). */
  label: ReactNode
  /** Optional quiet note after the label (13 px at 400), e.g. the scope the figures span. */
  badge?: ReactNode
}
```

### KpiCell

```ts
interface KpiCell {
  /** Caption shown above the value. Part of the cell's accessible name. */
  label: ReactNode
  /** The headline figure. Pre-format numbers for locale/currency. */
  value: ReactNode
  /** Small fraction shown next to the value, e.g. ` /14`. */
  fraction?: ReactNode
  /** Optional trend line under the value (e.g. `"+12% vs last week"`); its words stay neutral. */
  trend?: ReactNode
  /**
   * Draws a Lucide direction icon (TrendingUp / TrendingDown / Minus) before
   * the trend line, in the trend's tone: `up` reads as bad (danger), `down`
   * as good (success) unless KpiCell.trendTone says otherwise.
   */
  trendDirection?: "up" | "down" | "flat"
  /**
   * Explicit tone of the trend; overrides the direction's default. Shown as
   * the direction icon's colour; without a direction an alarming tone
   * (danger, warning) draws its icon of its own shape, any other tone only
   * sets the words in the foreground.
   */
  trendTone?: ToneName
  /** When set, the cell renders as a button: it turns a metric into a nav entry point. */
  onClick?: () => void
  /**
   * What activating the cell does ("Opens the incidents dashboard"). Read as
   * the button's DESCRIPTION (`aria-describedby`), so its accessible name
   * stays the visible label and value (WCAG 2.5.3, label in name).
   */
  actionHint?: string
}
```

### KpiGridSkeleton

```ts
/**
 * Loading placeholder with KpiGrid's geometry (same wrapper, grid and
 * cell padding), so the layout doesn't jump when the data arrives.
 * `aria-busy`; pair it with a status line if the wait is long.
 */
declare function KpiGridSkeleton(props: {
  /** How many cells the loaded grid will have. */
  cells: number
  /** The loaded grid's `boxed`. Default `false`. */
  boxed?: boolean
  className?: string
}): JSX.Element
```

### ToneName

```ts
/**
 * What a tone-aware component accepts: a ToneVariant, or a retired
 * name that resolveTone maps onto one.
 */
type ToneName =
  | "default"
  | ToneVariant
  | "critical"
  | "error"
  | "destructive"
  | "failure"
  | "warn"
  | "ok"
  | "positive"
  | "notice"
  | "muted"
  | "secondary"
```

### ToneVariant

```ts
/**
 * The tone vocabulary every Pulse UI speaks: `success | warning | danger | info | neutral`
 * (TONE_VARIANTS). Retired or foreign names (`critical`, `error`, `destructive`, …) map
 * onto it through resolveTone, so a tone that arrives as data (a server-built KPI cell)
 * never renders without a colour. Data only: how a tone looks is each UI's own (the kit's class
 * maps in `lib/tone-utils.ts`, the VS Code webview's stylesheets).
 */
type ToneVariant = "danger" | "warning" | "info" | "neutral" | "success"
```

### CountFigure

```ts
/**
 * A count as a plain figure (invariant 6: numbers stay neutral): the figure in the foreground in
 * tabular digits, never in a tone's colour or on a tint. An alarming count (an open incident, a
 * job without retries) draws its tone's 16 px icon of its own shape before the figure (a circled
 * cross for danger, a triangle for warning) and says why it alarms in words a screen reader reads
 * after the figure. For a figure in a table cell, a fact or a KPI tile; on its line's baseline, the
 * icon centred beside it. `CountBadge` is its pill, for a count at the end of a row.
 */
declare function CountFigure(
  props: {
    /** The figure, formatted (`formatNumber`, `formatCount`): it stays in the foreground. */
    children: ReactNode
    className?: string
  } & (
    | {
        situation?: undefined
        label?: undefined
      }
    | {
        /**
         * What the figure counts when it alarms (`openIncident`, `jobWithoutRetries`): its tone
         * (`SITUATION_TONES`) draws the tone's icon of its own shape before the figure. A situation
         * that does not alarm draws nothing.
         */
        situation:
          | "openIncident"
          | "incidentInCalledInstance"
          | "jobWithoutRetries"
          | "jobWithRetriesLeft"
          | "running"
          | "suspended"
          | "ended"
          | "healthy"
          | "idle"
        /** Why it alarms, in words for a screen reader ("No retries left"), read after the figure. */
        label: string
      }
  ),
): JSX.Element
```

### CountBadge

```ts
/**
 * A count as a 20 px pill (pills for counts: a named deviation), 13 px at 600 in tabular figures.
 * Numbers stay neutral (invariant 6): an alarming count shows its tone by a 12 px icon of the
 * tone's own shape (a circled cross for danger, a triangle for warning) before the number and
 * says what it counts in words (`label`, the accessible name with the exact count), never by a
 * coloured number. On a BPMN diagram (`diagram`) it fills in its tone, the named deviation the
 * diagram's badges keep. Rings are edges, so forced colours keep them. As a button it has a 24 px
 * target around the pill (WCAG 2.5.8).
 */
declare function CountBadge(props: {
  /**
   * The count, compact on screen (`1.2k`) in the kit's locale like the words around it; leave it
   * out for the badge as a sign (a legend).
   */
  count?: Count
  /**
   * The exact count and what it counts, in words ("3 instances with an incident"): the badge's
   * accessible name and its title. Required: a number alone means nothing.
   */
  label: string
  /**
   * What it counts, whose tone `SITUATION_TONES` gives. An alarming count (danger, warning) draws
   * the tone's icon of its own shape before the number; the number stays in the foreground.
   * Default: a count without a state.
   */
  situation?:
    | "openIncident"
    | "incidentInCalledInstance"
    | "jobWithoutRetries"
    | "jobWithRetriesLeft"
    | "running"
    | "suspended"
    | "ended"
    | "healthy"
    | "idle"
  /**
   * On a BPMN diagram, the named deviation: the badge fills in its tone. An open incident on the
   * danger fill and a running count on the primary, both with white text; an incident in a called
   * instance outlined in danger.
   */
  diagram?: boolean
  /** From an older read: on the raised surface with the field edge, the tone held back. */
  stale?: boolean
  /** `legend`: the smaller sign a legend explains (16 px high). */
  size?: "default" | "legend"
  /** Makes the badge a button (a filter by what it counts) with a 24 px target around it. */
  onClick?: (event: MouseEvent<HTMLButtonElement, MouseEvent>) => void
  className?: string
}): JSX.Element
```

### StateLabel

```ts
/**
 * A state as a 16 px icon in its situation's tone and the state's word in the foreground (the
 * webview's state label): no pill, no dot, no edge. Each state has an icon of its own shape and
 * one word in every Pulse UI. For a state in a table cell or a list; several in one cell sit
 * `gap-3` apart. A header's state may stay a `StatusBadge`. Its baseline is its word's (the icon
 * centred beside it), so it sits on the line of a term beside it (`Facts`). In a narrow table a
 * second state may show its icon alone (`iconOnlyBelow`).
 */
declare function StateLabel(props: {
  state: "running" | "suspended" | "ended" | "completed" | "cancelled" | "incident"
  /** Other words for the state; default: the kit's one word for it ("Running", "Läuft"). */
  children?: ReactNode
  /**
   * Below this width of the nearest container (a `DataTable`'s region is one; `sm` 24rem, `md`
   * 28rem) the label shows its icon alone, its word still read by a screen reader and in its
   * title. For a second state beside a first where a narrow table has no room for both words (an
   * open incident beside running): the icon's shape carries it, never its colour alone.
   */
  iconOnlyBelow?: "sm" | "md"
  className?: string
}): JSX.Element
```

### DataTable

```ts
/**
 * The kit's data table, in the one compact look (CI §8 tables, the webview's lists): 28 px rows
 * on the density roles, a sticky head of 13 px captions at 600 on the table's surface, a hover
 * fill on `--accent`, and inside a named scroll region a keyboard reaches (WCAG 1.4.10: a wide
 * table scrolls in it, never the document), which keeps a focused row clear of the sticky head
 * (`scroll-padding-top`, WCAG 2.4.11). Two ways to fill it: `rows` drawn by the columns' `cell`s,
 * one line each, the columns fitting their content and one taking the rest (`fill`, else the
 * last), with an optional row target (`onActivate`, one tab stop, the arrows between rows), copy
 * and selection column (`selection` from `rowSelection`); or `children`, rows composed by hand and
 * laid out by their content, where a column marked `fit` fits its one line as a drawn one does and
 * a `DataTableRow` is a target as a drawn row is. A target row is named (`rowLabel`, a
 * `DataTableRow`'s `label`) and tells a screen reader that Enter opens it.
 * Either way the heads keep one line, a `NamedId` in the body takes one line that gives way first
 * where the region is short of room, the columns can be sized by mouse and keyboard (`sizing`
 * from `useColumnSizing`, with a grip and a menu per head, each head named by its caption), and
 * `skeletonRows` stands in while it loads. The grips, the menus and the selection's boxes come
 * with `sizing` and `selection`, so a table without them never loads them. Props and callbacks
 * only: no host, no tool call; where widths are kept is the caller's (`useColumnSizing`'s `load`,
 * `save`).
 */
declare function DataTable<Row>(props: {
  /** Names the table and its scroll region. */
  label: string
  columns: readonly DataTableColumn<Row>[]
  /**
   * The rows, each drawn by the columns' `cell`s, one line each: every column fits its content
   * and one takes the rest (the `fill` column, else the last). Without them the table's body is
   * its `children`, rows composed by hand (`<tr>` with `Td`s), one cell per column, laid out by
   * their content, a column marked `fit` as narrow as its one line.
   */
  rows?: readonly Row[]
  /** A row's stable key (with `rows`). */
  rowKey?: (row: Row) => string
  /**
   * Makes each row a target (with `rows`): a click or Enter opens it, Ctrl or Cmd with them
   * beside the view. The rows then take one tab stop, and the arrows, Home and End move between
   * them.
   */
  onActivate?: (row: Row, how: RowActivation) => void
  /**
   * The accessible name of a row that opens (with `onActivate`): what it opens ("Instance
   * ORD-1001"). Without it a row is named by its cells. Either way a screen reader learns that
   * Enter opens it (and copies it, with `onCopy`).
   */
  rowLabel?: (row: Row) => string
  /** Ctrl or Cmd with C on a focused row copies what it names (with `rows`). */
  onCopy?: (row: Row) => void
  /**
   * What a screen reader hears after the name of a row that copies, where its copy is not its id
   * ("Enter opens the row, Ctrl or Cmd+C copies its incident message."); without it the kit's words
   * say that it copies its ID. It holds for the drawn rows (`onCopy`) and the composed ones
   * (`DataTableRow`'s `onCopy`) alike.
   */
  copyHint?: string
  /**
   * A selection column before the first one (with `rows`, from `rowSelection`); Space on a focused
   * row toggles it.
   */
  selection?: DataTableSelection<Row>
  /** While loading: this many placeholder rows (8 px bars) instead of the head and body. */
  skeletonRows?: number
  /** Shown under the head when `rows` is empty. */
  empty?: ReactNode
  /** Under the table, inside its scroll region (a "Load more"). */
  footer?: ReactNode
  /** The column sizing (`useColumnSizing`); without it every column fits its content. */
  sizing?: ColumnSizing
  /** Hand-composed body rows, when the table has no `rows`. */
  children?: ReactNode
  /**
   * Lets a long caption wrap where the region is short of room, so a wide table of figures keeps
   * every column in view. By default each head keeps one line, and a table short of room cuts a
   * `NamedId`'s line first, then scrolls inside its region.
   */
  wrapHeads?: boolean
  /** Rows above the column heads, inside the sticky head (heads over groups of columns). */
  headRows?: ReactNode
  /** A `<tfoot>`'s rows after the body. */
  foot?: ReactNode
  /** The body element, for a measure of its rows. */
  bodyRef?: Ref<HTMLTableSectionElement>
  /** Classes of the frame around the scroll region (its size in a layout). */
  className?: string
  /** Classes of the `<table>`. */
  tableClassName?: string
}): JSX.Element
```

### DataTableColumn

```ts
/** One column of a `DataTable`: its head and, for the `rows` of the table, its cell. */
interface DataTableColumn<Row> {
  /** Stable and unique in the table: the column's sizing key. */
  key: string
  /** The head's caption. */
  label?: ReactNode
  /** The column's name in words, for its sizing grip and menu (by default the caption's text). */
  name?: string
  align?: "left" | "right"
  /**
   * A bare head, the rule and the padding only: no caption treatment, never sized. For a head that
   * holds a control (the box that selects every row) instead of a caption; the row actions' column
   * has its caption ("Actions") like any other.
   */
  plain?: boolean
  sort?: "ascending" | "descending"
  /** Classes of the head cell. */
  className?: string
  /** A fixed width in CSS px: the column never sizes (a box, an icon). */
  width?: number
  /**
   * With `rows`, while the columns fit their content: this column takes the room the others
   * leave instead of the last one, so the identifying column (a `NamedId`) shows whole where there
   * is room and cuts its line first where there is not. One column at most.
   */
  fill?: boolean
  /**
   * With hand-composed `children`, while the columns are not sized: this column fits its content
   * as a drawn row's does, its cells one line and a `NamedId` in them whole, so the columns without
   * it share the room it leaves. The table marks the column's cells by their position, so a
   * composed row's cells take no class for it. A position counts the column spans of the cells
   * before it in its row, not the row spans of the rows above, so a cell that spans rows shifts the
   * cells below it. Drawn `rows` fit every column but the one that takes the rest by themselves.
   */
  fit?: boolean
  /** The cell of one of the table's `rows`. */
  cell?: (row: Row) => ReactNode
  /** Classes of each of its body cells (with `rows`). */
  cellClassName?: string
}
```

### RowActivation

```ts
/** How a row opened: in place, or beside the view (Ctrl or Cmd held). */
interface RowActivation {
  toSide: boolean
}
```

### TableEmptyState

```ts
declare function TableEmptyState(props: {
  /** What is empty, in plain words ("No open incidents"). */
  children: ReactNode
  variant?: "empty" | "done"
  /** One help line: why it is empty, or what to do next. */
  description?: ReactNode
  action?: ReactNode
  secondaryAction?: ReactNode
  /** A Lucide icon for the concrete situation (e.g. `<SearchX />` for no matches). */
  icon?: ReactNode
  /** Default `"p"`: it stands in for a table, not a section. */
  titleAs?: "h1" | "h2" | "h3" | "h4" | "p"
  className?: string
}): JSX.Element
```

### NamedId

```ts
/**
 * A process's or an element's name with its id, the same look in every module. Without a real
 * name the id leads once, in mono, so it never reads as a name. In a table cell (a `DataTable`'s
 * body) it takes one line (`layout="inline"`), so the row keeps its height; outside tables (a
 * detail's facts, a header) it stacks, and a long id wraps between its parts (`BreakableId`) so it
 * never widens what holds it. `layout` overrides where it sits.
 */
declare function NamedId(props: {
  name: string | null | undefined
  id: string
  lead?: ReactNode
  detail?: readonly ReactNode[]
  layout?: "stacked" | "inline"
  className?: string
}): JSX.Element
```

### ErrorState

```ts
/**
 * The one error pattern, the guide's status box (§8): on the tone's status surface with a 1 px
 * rim and a 4 px edge on the left in the tone, the second shadow and the md radius, at most
 * 560 px wide; a 16 px Lucide icon, a title at 600 that says what happened, a line that says
 * what you can do, the raw reason collapsed under "Details", and the retry and further actions
 * beside it (below it in a box under 30rem). All of it in 13 px. `inline` stands above content
 * that still renders (failed data steps), `block` replaces a whole view or widget body; they
 * differ in the title's element.
 */
declare function ErrorState(props: {
  /** What happened, in plain words ("This view couldn't be loaded"). */
  title: ReactNode
  /** What you can do next, or the human reason when you can map the raw one. */
  description?: ReactNode
  /**
   * The raw technical reason (engine exception, HTTP status), shown collapsed
   * under a "Details" disclosure so it informs without leading.
   */
  details?: ReactNode
  /** Summary text of the details disclosure. Default: the locale's "Details". */
  detailsLabel?: string
  /** Renders a retry button when set. */
  onRetry?: () => void
  /** Retry button label. Default: the locale's "Try again". */
  retryLabel?: string
  /** Further actions after the retry button (e.g. a link to another view). */
  actions?: ReactNode
  /**
   * Default `"danger"`. `"warning"` for partial failures, `"info"` for
   * notices. An untyped retired name still resolves (`error` → `danger`).
   */
  tone?: "danger" | "warning" | "info"
  /** Replace the tone's default Lucide icon. */
  icon?: LucideIcon
  /**
   * `"block"` (default): the state that replaces a whole view or widget body.
   * `"inline"`: a compact alert above content that still renders.
   */
  variant?: "inline" | "block"
  /**
   * Live-region role. Default `"alert"`: an error that appears after the
   * fact is announced. Use `"status"` for a quieter notice, or `"none"` when
   * the state is part of the first paint.
   */
  role?: "alert" | "status" | "none"
  /** Element of the title. Default `"h2"` for `block`, `"p"` for `inline`. */
  titleAs?: "h1" | "h2" | "h3" | "h4" | "p"
  className?: string
}): JSX.Element
```

### Skeleton

```ts
declare function Skeleton(
  props: DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement>,
): JSX.Element
```

### Button

```ts
declare function Button(props: {
  size?: null | "default" | "sm" | "lg" | "xs" | "icon" | "icon-xs" | "icon-sm" | "icon-lg"
  variant?:
    null | "default" | "destructive" | "secondary" | "link" | "toolbar" | "outline" | "ghost"
  asChild?: boolean
  // …and the props of the element it renders
}): JSX.Element
```

### Icon

```ts
/**
 * Stroke set on the icon itself so it holds outside a `LucideProvider` too, at every size.
 * `dense` is the 12 px icon beside dense text and on 20 px badges, the named deviation of the
 * density section (root CLAUDE.md): only in the files a brand gate's `allowDense` lists.
 * Decorative by default; `label` only for a standalone icon that carries meaning.
 */
declare function Icon(props: {
  icon: LucideIcon
  size?: number
  dense?: boolean
  label?: string
  className?: string
}): JSX.Element
```

### LocaleProvider

```ts
/**
 * Provide the active locale (and an optional translator) to a subtree. Widgets
 * read it with useLocale / useTranslate. Pure React, so it
 * works in a host, a standalone app, or a test alike.
 *
 * The locale itself is app-specific (a header, a user profile, a session
 * store …): resolve it on the host/server and pass it in.
 */
declare function LocaleProvider(props: {
  /** The active locale tag (e.g. `"en"`, `"de"`). */
  locale: string
  /**
   * A Translate over your own catalogs. Omit to provide the locale only
   * (translate echoes keys), useful while you wire the locale before any
   * catalog exists. The kit's own strings need no translator.
   */
  translator?: Translate
  /**
   * Override individual kit strings for this subtree, per catalog section
   * (e.g. `{ listFooter: { loadMore: "Show more" } }`). Omitted entries keep the
   * shipped `en`/`de` catalog of `locale`.
   */
  uiMessages?: UiMessagesOverride
  children: ReactNode
}): ReactNode
```

### useLocale

```ts
/** Read the active locale tag from the nearest LocaleProvider. */
declare function useLocale(): string
```

### createUseT

```ts
/**
 * A module's `useT` over its own translator: the hook reads the locale of the nearest `LocaleProvider`.
 */
declare function createUseT(translator: Translate): () => T
```

### Translate

```ts
/**
 * A translator over catalogs keyed by locale: any function of this shape, for
 * example a lookup in `{ en: { … }, de: { … } }` that fills `{param}` slots.
 */
type Translate = (
  locale: string,
  key: string,
  params?: Record<string, unknown> | undefined,
) => string
```

### T

```ts
/** A locale-bound translate for widgets: `t(key, params?) => string`. */
type T = (key: string, params?: Record<string, unknown> | undefined) => string
```

### cn

```ts
declare function cn(...inputs: ClassValue[]): string
```

## @miragon/pulse-ui/format

```ts
import {
  setFormatLocale,
  type Count,
  formatCount,
  formatCompactCount,
  formatNumber,
  formatPercent,
  formatDuration,
  formatClock,
  formatInstant,
  formatTimestamp,
  formatDate,
  formatRelativeTime,
  shortId,
  truncate,
} from "@miragon/pulse-ui/format"
```

### setFormatLocale

```ts
/** A no-op for an unchanged value, so subscribers re-render only on a real change. */
declare function setFormatLocale(
  next:
    | {
        language: string
        /**
         * The host's full tag when it speaks `language`; a `-u-hc-h23` extension picks a 24-hour clock.
         */
        locale: string
        timeZone?: string
      }
    | undefined,
): void
```

### Count

```ts
/**
 * A count: exact, a lower bound that a capped read vouches for (`{ atLeast }`), or unknown
 * (`null`), which renders "—", never a `0` that reads as fact.
 */
type Count = number | { atLeast: number } | null | undefined
```

### formatCount

```ts
/** `1,234`; a lower bound `≥ 2,000`; unknown `—`. */
declare function formatCount(count: Count): string
```

### formatCompactCount

```ts
/**
 * Below the language's threshold exact and grouped (`999`, German `12.345`), above it compact in
 * the view's locale (`1.2k`, `1.5M`, German `1,5 Mio.`), a lower bound with a `+` (`10k+`);
 * unknown `—`. English writes the thousands with a small `k` and keeps `M` and `B`, so a million
 * never reads as the minutes of a duration (`3m 7s`). For a narrow place with the exact count
 * beside it (a tooltip, a title).
 */
declare function formatCompactCount(count: Count): string
```

### formatNumber

```ts
declare function formatNumber(
  value: number | null | undefined,
  options?: NumberFormatOptions,
): string
```

### formatPercent

```ts
/** Takes PERCENT units: 3.7 means 3.7 %. */
declare function formatPercent(
  percent: number | null | undefined,
  options?: {
    /** Default 1, raised to `minimumFractionDigits` when that is larger. */
    maximumFractionDigits?: number
    /** Default 0; set it equal to the maximum for aligned table columns. */
    minimumFractionDigits?: number
    signed?: boolean
  },
): string
```

### formatDuration

```ts
/**
 * The one duration form, in its two largest units: English `420ms`, `3m 7s`, `1h 24m`, `2d 3h`;
 * German `3 Min. 7 s`, `2 d 3 h`. Fractional milliseconds are rounded.
 */
declare function formatDuration(ms: number | null | undefined): string
```

### formatClock

```ts
/**
 * The time of day alone when it falls on today in the view's time zone, else with its day before
 * it (`09:05` / `Oct 21, 09:05`, on a 12-hour clock `9:05 AM` / `Oct 21, 9:05 AM`): for a list or
 * a stamp, where the day is mostly today.
 */
declare function formatClock(
  iso: string | null | undefined,
  opts?: {
    /** The moment whose day counts as today; default now. */
    now?: Date
    /** Default true; false shows hours and minutes only. */
    seconds?: boolean
    /** Adds the milliseconds (`09:05:07.042`), so runs a few milliseconds apart stay apart. */
    milliseconds?: boolean
  },
): string
```

### formatInstant

```ts
/** The full instant in the view's time zone and in UTC, for a tooltip beside a clock. */
declare function formatInstant(iso: string | null | undefined): string
```

### formatTimestamp

```ts
declare function formatTimestamp(iso: string | null | undefined): string
```

### formatDate

```ts
declare function formatDate(iso: string | null | undefined): string
```

### formatRelativeTime

```ts
/**
 * How far `iso` lies from `now` in its largest whole unit, from minutes to days (`5m ago`,
 * `vor 5 Min.`, `in 2h`); under a minute in words.
 */
declare function formatRelativeTime(iso: string | null | undefined, now?: Date): string
```

### shortId

```ts
/**
 * An id short enough to scan: up to 12 characters whole, a longer number by its tail
 * (`…13685249`: big-integer keys of one engine share their head), a UUID by its head
 * (`5f0ce78e…`), any other id whole (only those two have a part that is safe to drop). Show the
 * full id beside it (a title, a copy button).
 */
declare function shortId(id: string): string
```

### truncate

```ts
declare function truncate(value: string | null | undefined, max: number): string
```

## @miragon/pulse-ui/tones

```ts
import { type Situation, SITUATION_TONES, VERDICT_TONES } from "@miragon/pulse-ui/tones"
```

### Situation

```ts
/** A situation SITUATION_TONES gives a tone. */
type Situation =
  | "openIncident"
  | "incidentInCalledInstance"
  | "jobWithoutRetries"
  | "jobWithRetriesLeft"
  | "running"
  | "suspended"
  | "ended"
  | "healthy"
  | "idle"
```

### SITUATION_TONES

```ts
/**
 * The situations a person meets on a process engine, each with the ONE tone it shows in every
 * Pulse UI: the MCP widgets read it at runtime, the VS Code webview's state labels read it and
 * its tests hold the diagram badges to it. Same situation, same colour; a new UI looks its tone
 * up here instead of choosing one.
 *
 * It tones a situation where a UI shows it as a state: a label, a badge, a dot, a count pill. A
 * drawing that is no state stays outside it, as the VS Code diagram's green path (the elements an
 * instance passed and the flows it took, its legend says so) and the strip a notice sits in.
 *
 * The ladder: what waits for a person is `danger`; what can still recover on its own is
 * `warning`; a running instance or element shown as its state is `info`; everything else,
 * including a process that runs without a problem, is `neutral` (never a green "healthy": green
 * would claim "done well" over something nobody looked at). A count of a situation is a figure
 * and stays neutral beside the tone (`countTone` tones a count of problems only).
 */
declare const SITUATION_TONES: {
  readonly openIncident: "danger"
  readonly incidentInCalledInstance: "danger"
  readonly jobWithoutRetries: "danger"
  readonly jobWithRetriesLeft: "warning"
  readonly running: "info"
  readonly suspended: "neutral"
  readonly ended: "neutral"
  readonly healthy: "neutral"
  readonly idle: "neutral"
}
```

### VERDICT_TONES

```ts
/**
 * An engine's own state, its one live verdict (`ok`, `warning` or `critical`, c7-core's
 * `engineVerdict`), as the ONE tone every Pulse UI that shows it reads: the chat's overview badge
 * and engine dots, the web app's engine screen and start page. An engine that runs without a
 * problem is the table's `healthy`, neutral as a process is, never a green "healthy"; a degraded
 * one `warning`; a critical one has an open incident's danger.
 */
declare const VERDICT_TONES: {
  readonly ok: "neutral"
  readonly warning: "warning"
  readonly critical: "danger"
}
```

## @miragon/pulse-blocks

```ts
import {
  BadgeCluster,
  BadgeLegend,
  type CountBadgeProps,
  type ScreenOpenHow,
} from "@miragon/pulse-blocks"
```

### BadgeCluster

```ts
/**
 * The counts on an element of a process's diagram, apart: its root incidents, the incidents in the
 * instances it called (never part of the incident count), its running instances. Each is a button
 * that filters the instance list to the element and the count's scope; the surface draws the badge.
 */
declare function BadgeCluster(props: {
  /** The element's counts, the process screen's badge of it (`DiagramDecorations` orders them). */
  readonly badge: ElementBadgeData
  /** The element's name, as the surface knows it (else its id). */
  readonly elementName: string
  /** The counts are older than the list under them (a refresh runs). */
  readonly stale?: boolean
  /** A count's click: the list filtered to the element and the count's scope. */
  readonly onSelect: (elementId: string, scope: InstanceScopeCode, how: ScreenOpenHow) => void
  /** The surface's count badge, as its diagram draws one. */
  readonly Badge: ComponentType<CountBadgeProps>
}): JSX.Element
```

### BadgeLegend

```ts
/**
 * The legend of a process's diagram behind a button: which version the badges count, and what each
 * badge says (waiting here, a root incident here, an incident in a called instance), with the
 * surface's sample of each. It opens over the diagram and closes on Escape.
 */
declare function BadgeLegend(props: {
  /** The version whose diagram the badges count on. */
  readonly version: number
  /** The surface's count badge, as its diagram draws one, shown as each entry's sample. */
  readonly Badge: ComponentType<CountBadgeProps>
}): JSX.Element
```

### CountBadgeProps

```ts
/**
 * The props of the surface's count badge, as its diagram draws one: its kind, its count (none in a
 * legend's sample) and whether the counts are stale. Its look is the canvas's (the editors' filled
 * 20 px pills, the web app's badges on its BPMN canvas).
 */
interface CountBadgeProps {
  readonly kind: "running" | "incidents" | "incidentsInCalledInstances"
  readonly count?: number
  readonly stale?: boolean
  /** A legend's sample, not a count on the diagram. */
  readonly legend?: boolean
}
```

### ScreenOpenHow

```ts
/** How a target opens: in place, or beside the view (Ctrl or Cmd held) where the surface can. */
interface ScreenOpenHow {
  readonly toSide: boolean
}
```

## @miragon/pulse-screens

```ts
import {
  DiagramDecorations,
  type ElementBadgeData,
  type ElementDecorationData,
  type BadgeCountData,
  type CallLinkData,
  type CalledInstanceData,
  type DefinitionRefData,
  type InstanceScopeCode,
} from "@miragon/pulse-screens"
```

### DiagramDecorations

```ts
declare class DiagramDecorations {
  static of(props: {
    readonly badges: readonly ElementBadgeData[]
    readonly calls: readonly CallLinkData[]
  }): ElementDecorationData[]
}
```

### ElementBadgeData

```ts
interface ElementBadgeData {
  readonly elementId: string
  readonly running: number
  readonly incidents: number
  readonly incidentsInCalledInstances: number
}
```

### ElementDecorationData

```ts
interface ElementDecorationData {
  readonly elementId: string
  readonly counts: readonly BadgeCountData[]
  readonly incident: boolean
  readonly call: CallLinkData | null
}
```

### BadgeCountData

```ts
interface BadgeCountData {
  readonly kind: "running" | "incidents" | "incidentsInCalledInstances"
  readonly count: number
  readonly scope: "running" | "withIncident"
}
```

### CallLinkData

```ts
type CallLinkData =
  | {
      readonly elementId: string
      readonly kind: "instances"
      readonly instances: readonly CalledInstanceData[]
    }
  | {
      readonly elementId: string
      readonly kind: "definition"
      readonly definition: DefinitionRefData
    }
  | { readonly elementId: string; readonly kind: "missing"; readonly bpmnProcessId: string }
```

### CalledInstanceData

```ts
interface CalledInstanceData {
  readonly id: string
  readonly bpmnProcessId: string
  readonly state: "running" | "suspended" | "completed" | "terminated"
  readonly withIncident: boolean
}
```

### DefinitionRefData

```ts
interface DefinitionRefData {
  readonly id: string
  readonly bpmnProcessId: string
  readonly version: number
  readonly name?: string
}
```

### InstanceScopeCode

```ts
type InstanceScopeCode = "running" | "ended" | "withIncident" | "all"
```

## @miragon/pulse-ui/bpmn

```ts
import {
  BpmnDiagram,
  type DiagramDecoration,
  type DiagramCount,
  type DiagramCountKind,
  type DiagramMarker,
  type DiagramMarkerKind,
  type DiagramElement,
  type DiagramSelectHow,
  type DiagramCountsProps,
  DiagramLegend,
  CanvasBadge,
  useBpmnViewer,
  type BpmnViewerWithGet,
  type BpmnCanvas,
  type BpmnOverlays,
  BpmnZoomControls,
  parseBpmnNames,
  readBpmnNames,
} from "@miragon/pulse-ui/bpmn"
```

### BpmnDiagram

```ts
/**
 * A BPMN diagram on the kit's themed canvas, for any React page, with no host: the drawing with
 * Pulse's markers and count badges in the one badge scheme (owner decision 2026-11-24, the shared
 * screens'), the zoom bar at its top right (bpmn.io's link takes the bottom right) and the fit.
 * Each element's counts sit apart over its top right corner: its open root incidents in the
 * incident's colour, the incidents in the instances it called quiet in a badge of their own, its
 * running instances on the info ramp; only an own root incident outlines the element. An element
 * the drawing lacks is skipped without an error. It draws again when the elements it decorates
 * change; a count that changes on an element that has counts changes in place, so a refresh keeps
 * the reader's zoom. The canvas follows the theme (light, dark, high contrast, forced colours)
 * from its own stylesheet (`BPMN_OVERLAY_CSS`), which it injects, so a page imports no CSS for it.
 */
declare function BpmnDiagram<C>(props: {
  /** The BPMN 2.0 XML to draw. */
  readonly xml: string
  /** The diagram's name: the canvas becomes the image under it (the process and its version). */
  readonly ariaLabel: string
  /**
   * What each element shows: its counts (a badge each) and a root incident's outline. The shared
   * screens' decorations (`DiagramDecorations.of` of `@miragon/pulse-screens`) are this shape. An
   * element the drawing lacks is skipped.
   */
  readonly decorations?: readonly DiagramDecoration<C>[]
  /** Outlines without a count (an instance's wait, an open user task, an incident). */
  readonly markers?: readonly DiagramMarker[]
  /** An element's name for its counts' words; default the name the XML gives it, else its id. */
  readonly nameOf?: (elementId: string) => string
  /**
   * A count's click: each count a button (the page decides where it leads). Without it the counts
   * are a drawing (`aria-hidden`), and the page says them in words elsewhere.
   */
  readonly onSelect?: (element: DiagramElement, count: C, how: DiagramSelectHow) => void
  /**
   * Whether a count leads somewhere; one that leads nowhere is drawn without a button, its words
   * for a screen reader and as its tooltip. Default: every count does.
   */
  readonly selectable?: (element: DiagramElement, count: C) => boolean
  /** The counts are older than what the page shows beside them (a refresh runs): neutral. */
  readonly stale?: boolean
  /** A surface's own counts of an element, drawn in its anchor instead of the kit's cluster. */
  readonly renderCounts?: (props: DiagramCountsProps<C>) => ReactNode
  /**
   * After each drawing, with the viewer: a surface's own decoration (a marker it moves in place,
   * an overlay it portals into `children`). Its cleanup runs before the next drawing.
   */
  readonly onDrawn?: (viewer: BpmnViewerWithGet) => void | (() => void)
  /** A new value draws the diagram anew: what `onDrawn` decorates changed. */
  readonly redrawKey?: unknown
  /**
   * The frame's height: a number of pixels, `"fill"` for the height of the box it sits in, or the
   * diagram's own (240 to 560 px, by its drawing and the canvas's width).
   */
  readonly height?: number | "fill"
  /** The tallest the diagram's own height may grow: an inline chat card's budget. */
  readonly maxHeight?: number | null
  /** Fits the diagram again when the canvas resizes. Default true. */
  readonly fitOnResize?: boolean
  /** A border around the canvas. Default true; off where the box it sits in draws one. */
  readonly framed?: boolean
  /** What the canvas says when bpmn-js could not draw the XML; default the kit's words. */
  readonly drawFailed?: string
  readonly className?: string
  /** Laid in the frame over the canvas: a surface's own overlays (portals) and controls. */
  readonly children?: ReactNode
}): JSX.Element
```

### DiagramDecoration

```ts
/**
 * An element's decoration: its counts, each drawn as its own badge, and whether it holds a root
 * incident, which outlines it in the incident's colour. The screens' `ElementDecorationData` is
 * one (its scope and call target ride along).
 */
interface DiagramDecoration<C> {
  readonly elementId: string
  readonly counts: readonly C[]
  readonly incident: boolean
}
```

### DiagramCount

```ts
/** One count on an element: its kind and its number. */
interface DiagramCount {
  readonly kind: "running" | "incidents" | "incidentsInCalledInstances"
  readonly count: number
}
```

### DiagramCountKind

```ts
/**
 * What a badge on an element counts: its open root incidents, the incidents in the instances it
 * called (never part of its incident count), its running instances.
 */
type DiagramCountKind = "running" | "incidents" | "incidentsInCalledInstances"
```

### DiagramMarker

```ts
interface DiagramMarker {
  readonly elementId: string
  readonly kind: "running" | "incident" | "openTask"
}
```

### DiagramMarkerKind

```ts
/**
 * An outline without a count: where an instance waits (`running`), an open user task (a heavier
 * dashed stroke, shape not colour), an incident.
 */
type DiagramMarkerKind = "running" | "incident" | "openTask"
```

### DiagramElement

```ts
/** An element of the drawing as a count names it: its id and its BPMN type (`bpmn:UserTask`). */
interface DiagramElement {
  readonly id: string
  /** As bpmn-js reads it; empty where the drawing does not say. */
  readonly type: string
}
```

### DiagramSelectHow

```ts
/** How a count was clicked: Ctrl or Cmd held asks for the target beside the page. */
interface DiagramSelectHow {
  readonly toSide: boolean
}
```

### DiagramCountsProps

```ts
/** What a surface's own counts of an element get (`renderCounts`). */
interface DiagramCountsProps<C> {
  readonly element: DiagramElement
  /** Its counts above 0, in the badges' order (root incidents first). */
  readonly counts: readonly C[]
  readonly elementName: string
  readonly stale: boolean
}
```

### DiagramLegend

```ts
/**
 * The legend of a diagram's counts behind a button: what each badge says (waiting here, an
 * incident here, an incident in a called instance), each with its badge as `BpmnDiagram` draws it,
 * led by the page's line of what they count. It opens over the diagram and closes on Escape.
 */
declare function DiagramLegend(props: {
  /** Its first line: what the badges count ("Badges count running instances of v3"). */
  readonly scope?: string
  /** The badges it explains, in the diagram's order; default all three. */
  readonly kinds?: readonly DiagramCountKind[]
  /** Where it opens from its button: below it (default) or above it. */
  readonly placement?: "bottom" | "top"
  readonly className?: string
}): JSX.Element
```

### CanvasBadge

```ts
/**
 * A count's badge on the BPMN canvas: a pill, its count compact, the incidents in called instances
 * with the incident's icon at the overlays' 12 px beside it; neutral while stale, a legend's
 * sample without a count. A drawing (`aria-hidden`): what names it is the count's button or the
 * page's words. It brings the canvas's stylesheet, so a legend draws it where no diagram mounted;
 * as the blocks' `Badge` slot it is the surface's badge of the shared screens.
 */
declare function CanvasBadge(props: {
  readonly kind: "running" | "incidents" | "incidentsInCalledInstances"
  /** None in a legend's sample. */
  readonly count?: number
  /** The counts are older than what the page shows beside them (a refresh runs): neutral. */
  readonly stale?: boolean
  /** A legend's sample, not a count on the diagram: smaller. */
  readonly legend?: boolean
}): JSX.Element
```

### useBpmnViewer

```ts
declare function useBpmnViewer(props: {
  bpmnXml: string
  /** Read at import time, so a new function identity alone never re-imports. */
  onImported?: (viewer: BpmnViewerWithGet) => void | (() => void)
  /** A new identity remounts the viewer: bpmn-js decoration is add-only. */
  reimportKey?: unknown
  /** Off by default: the heatmap preserves the operator's pan/zoom. */
  fitOnResize?: boolean
  /**
   * The elements the view marks (an incident's, a wait state's): the first zoom in after a fit
   * centres them, so a phone that fits the whole process small zooms straight to the problem.
   * Read at the zoom, so a new array identity alone changes nothing.
   */
  markedIds?: readonly string[]
  /**
   * The tallest the frame may grow, below the diagram's own maximum (560 px): an inline chat card's
   * budget (widget-shell's `useDiagramMaxHeight`). None, or null, for the diagram's own.
   */
  maxHeight?: number | null
  /**
   * The diagram's name. The canvas alone (bpmn-js's SVG) becomes the image (`role="img"`) under
   * it, so what lies beside the canvas in the frame (the zoom controls, bpmn.io's link) stays
   * outside any image: an image's content is presentational, a control inside it would be lost to
   * assistive technology (axe's nested-interactive). Never put the role on the frame. An overlay a
   * caller draws over the canvas (a count badge) reads beside the image, so the caller hides it
   * (`aria-hidden`) and says its value in words elsewhere in the view.
   */
  ariaLabel?: string
}): {
  containerRef: RefObject<HTMLDivElement | null>
  height: number
  importError: string | null
  /** A step in (`ZOOM_STEP`); the first after a fit centres the marked elements (`markedIds`). */
  zoomIn: () => void
  /** A step out (`ZOOM_STEP`), never past bpmn-js's limit and never in. */
  zoomOut: () => void
  /**
   * Fits the whole diagram, never past 1:1, clear of what lies over its canvas: `BpmnZoomControls`
   * beside the container in its frame (the container's parent) and bpmn.io's link.
   */
  fit: () => void
}
```

### BpmnViewerWithGet

```ts
interface BpmnViewerWithGet {
  get: ((service: "canvas") => BpmnCanvas) &
    ((service: "overlays") => BpmnOverlays) &
    ((service: "elementRegistry") => BpmnElementRegistry) &
    ((service: "eventBus") => BpmnEventBus)
}
```

### BpmnCanvas

```ts
/** bpmn-js ships no usable types on `Viewer#get`; the slice the widgets use. */
interface BpmnCanvas {
  zoom: { (level: number): void; (): number }
  addMarker: (elementId: string, marker: string) => void
  /** Shows `box` (diagram units) on the whole canvas, at the scale that fits it. */
  viewbox: {
    (): {
      x: number
      y: number
      width: number
      height: number
      scale: number
      inner?: { x: number; y: number; width: number; height: number } | undefined
      outer?: { width: number; height: number } | undefined
    }
    (box: FitRect): unknown
  }
  /** diagram-js's container of the canvas, the box its size is read from. */
  getContainer: () => HTMLElement
  /** Drops diagram-js's cached viewbox; a fit after a resize would scale against the old size. */
  resized: () => void
  /** Moves the drawing by `dx`, `dy` canvas pixels (a positive `dx` moves it right). */
  scroll: (delta: { dx: number; dy: number }) => unknown
}
```

### BpmnOverlays

```ts
interface BpmnOverlays {
  add: (elementId: string, overlay: { position: object; html: string }) => void
}
```

### BpmnZoomControls

```ts
/**
 * Top-right, not bottom-right: bpmn-js pins its bpmn.io logo (licence requirement) there at z-index
 * 100, covering zoom-out. In the theme, as the canvas under it (a raised card on its paper).
 * Placed beside the viewer's container in one frame, as `useBpmnViewer` expects: its fit keeps the
 * diagram clear of the bar (and of the logo) wherever the bar lies.
 */
declare function BpmnZoomControls(props: {
  onZoomIn: () => void
  onZoomOut: () => void
  onFit: () => void
  labels?: {
    zoomIn?: string
    zoomOut?: string
    fit?: string
  }
  /** Merged over the default placement (e.g. `top-6 right-6` repositions). */
  className?: string
}): JSX.Element
```

### parseBpmnNames

```ts
declare function parseBpmnNames(
  xml: string,
  processDefinitionKey: string,
): {
  /** Else the name of the pool that holds it. */
  name: string | null
  elements: Record<string, string>
}
```

### readBpmnNames

```ts
/** A document that is not BPMN yields no names, never an error. */
declare function readBpmnNames(xml: string): {
  processes: Record<string, string>
  elements: Record<string, string>
}
```

## @miragon/pulse-widget-shell/widgets

```ts
import {
  describeError,
  type PageHints,
  isPermanentError,
} from "@miragon/pulse-widget-shell/widgets"
```

### describeError

```ts
/**
 * Never the raw "[503 ProcessEngineException] …" as the headline; feed the result to pulse-ui's `ErrorState`.
 */
declare function describeError(
  error: unknown,
  locale: string | undefined,
  options?: {
    fallbackTitle?: string
    /**
     * What the host does with a hand-off (`ViewHost.followUp`), which says where the view sits: a
     * chat's words (`chat`, the default) may send the reader there, a page's (`copy`, `none`) say
     * what to do on the page, as the view frame's do (`pageHints`).
     */
    followUp?: "none" | "chat" | "copy"
    /**
     * A page's words of what to do (`ViewHost.pageHints`), which its host brings: a page's
     * `followUp` reads them where a kind's chat words would send the reader to the chat.
     */
    pageHints?: Readonly<
      Record<
        "en" | "de",
        Readonly<
          Partial<
            Record<
              | "profileRefused"
              | "readOnly"
              | "notServed"
              | "signedOut"
              | "unknownBoard"
              | "boardRefused"
              | "invalidArguments"
              | "unreachable"
              | "timeout"
              | "notOnServer"
              | "unauthorized"
              | "forbidden"
              | "notFound"
              | "failed"
              | "unknown",
              string
            >
          >
        >
      >
    >
  },
): {
  kind:
    | "profileRefused"
    | "readOnly"
    | "notServed"
    | "signedOut"
    | "unknownBoard"
    | "boardRefused"
    | "invalidArguments"
    | "unreachable"
    | "timeout"
    | "notOnServer"
    | "unauthorized"
    | "forbidden"
    | "notFound"
    | "failed"
    | "unknown"
  /** What happened, one line ("Die Engine prod ist nicht erreichbar (HTTP 503)"). */
  title: string
  hint: string
  details: string | null
}
```

### PageHints

```ts
/**
 * A page's words of what to do after a failure (`describeError` where its `followUp` is not
 * `chat`), for each kind whose chat words send the reader to the chat: on a page that posts to no
 * chat they say what to do there instead. Every other kind's hint is the same in both.
 */
type PageHints = {
  readonly en: Readonly<
    Partial<
      Record<
        | "profileRefused"
        | "readOnly"
        | "notServed"
        | "signedOut"
        | "unknownBoard"
        | "boardRefused"
        | "invalidArguments"
        | "unreachable"
        | "timeout"
        | "notOnServer"
        | "unauthorized"
        | "forbidden"
        | "notFound"
        | "failed"
        | "unknown",
        string
      >
    >
  >
  readonly de: Readonly<
    Partial<
      Record<
        | "profileRefused"
        | "readOnly"
        | "notServed"
        | "signedOut"
        | "unknownBoard"
        | "boardRefused"
        | "invalidArguments"
        | "unreachable"
        | "timeout"
        | "notOnServer"
        | "unauthorized"
        | "forbidden"
        | "notFound"
        | "failed"
        | "unknown",
        string
      >
    >
  >
}
```

### isPermanentError

```ts
/**
 * A failure the view neither retries by itself nor offers Try again for: its hint says the way out.
 */
declare function isPermanentError(error: unknown): boolean
```

## @miragon/pulse-c7-core

```ts
import { isRootIncident } from "@miragon/pulse-c7-core"
```

### isRootIncident

```ts
/**
 * Whether `incident` was raised where it is, not copied up from a called instance: it names no
 * root incident but itself (`rootIdOfCopy`, which also decides a missing `rootCauseIncidentId`).
 */
declare function isRootIncident(incident: {
  readonly id?: unknown
  readonly rootCauseIncidentId?: unknown
}): boolean
```
