import { CircleXIcon } from "lucide-react"
import { Card, CountFigure, Icon, SectionHeading, TONE_ICON, cn } from "@miragon/pulse-ui"
import type { TileData } from "@miragon/pulse-board"
import { useId, type ReactNode } from "react"
import { useWords } from "../messages/translate.js"

export interface BoardCardProps {
  readonly title: string
  readonly kind: TileData["kind"]
  readonly children: ReactNode
}

/** A line of a tile's list: an engine or a process with its count. */
export const BOARD_LINE = "flex min-h-control w-full items-center gap-2 px-2 text-left"

/** Such a line as a button that opens what it counts. */
export const BOARD_LINE_BUTTON = cn(BOARD_LINE, "justify-start font-normal has-[>svg]:px-2")

/** The notes under a table: each engine's share. */
export const GROUP_NOTES = "text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-1.5 py-0.5"

const FLUSH: ReadonlySet<TileData["kind"]> = new Set(["instanceList", "incidentList"])

/** A tile's card: a region named by its title; a table runs to its edges. */
export function BoardCard({ title, kind, children }: BoardCardProps) {
  const heading = useId()
  const flush = FLUSH.has(kind)
  return (
    <Card
      role="region"
      data-part="board-card"
      data-kind={kind}
      aria-labelledby={heading}
      className={cn("min-w-0 gap-2", flush && "pb-0")}
    >
      <SectionHeading as="h2" id={heading} title={title} className="mb-0 min-w-0 px-3" />
      {flush ? children : <div className="flex min-w-0 flex-col gap-2 px-3">{children}</div>}
    </Card>
  )
}

export interface BoardFigureProps {
  readonly text: string
  readonly part?: "counter-value" | "counter-count"
  readonly alarm: boolean
  readonly quiet?: boolean
  readonly className?: string
}

/** A count as a neutral figure; a count of instances with incident alarms by an icon and words. */
export function BoardFigure({ text, part, alarm, quiet = false, className }: BoardFigureProps) {
  const t = useWords()
  const figure = (
    <span data-part={part} data-tone={alarm ? "danger" : undefined}>
      {text}
    </span>
  )
  const classes = cn(quiet && "text-muted-foreground", className)
  return alarm ? (
    <CountFigure situation="openIncident" label={t("withIncident")} className={classes}>
      {figure}
    </CountFigure>
  ) : (
    <CountFigure className={classes}>{figure}</CountFigure>
  )
}

/** The note of an engine that was not read, in a list of engines. */
export function MissingNote({ engine }: { readonly engine: string }) {
  const t = useWords()
  return (
    <li className="text-foreground inline-flex items-center gap-1.5" data-part="group-note">
      <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
      {t("group.notRead", { engine })}
    </li>
  )
}

/** What a tile says when it has nothing to show. */
export function EmptyNote({ text }: { readonly text: string }) {
  return (
    <div
      className="text-dense text-muted-foreground flex flex-col items-center justify-center gap-3 px-3 py-6 text-center"
      data-part="empty-hint"
    >
      <p className="max-w-prose text-balance">{text}</p>
    </div>
  )
}
