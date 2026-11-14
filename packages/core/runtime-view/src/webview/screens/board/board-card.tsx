import { CircleXIcon } from "lucide-react"
import { Card, CountFigure, Icon, SectionHeading, TONE_ICON, cn } from "@miragon/pulse-ui"
import { useId, type ReactNode } from "react"
import type { BoardTile } from "../../../core/protocol/index.js"

export interface BoardCardProps {
  readonly title: string
  readonly kind: BoardTile["kind"]
  readonly children: ReactNode
}

export const BOARD_LINE = "flex min-h-control w-full items-center gap-2 px-2 text-left"

export const BOARD_LINE_BUTTON = cn(BOARD_LINE, "justify-start font-normal has-[>svg]:px-2")

export const GROUP_NOTES = "text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 px-1.5 py-0.5"

const FLUSH: ReadonlySet<BoardTile["kind"]> = new Set(["instanceList", "incidentList"])

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

export function BoardFigure({ text, part, alarm, quiet = false, className }: BoardFigureProps) {
  const figure = (
    <span data-part={part} data-tone={alarm ? "danger" : undefined}>
      {text}
    </span>
  )
  const classes = cn(quiet && "text-muted-foreground", className)
  return alarm ? (
    <CountFigure situation="openIncident" label="with incident" className={classes}>
      {figure}
    </CountFigure>
  ) : (
    <CountFigure className={classes}>{figure}</CountFigure>
  )
}

export function MissingNote({ engine }: { readonly engine: string }) {
  return (
    <li className="text-foreground inline-flex items-center gap-1.5" data-part="group-note">
      <Icon icon={CircleXIcon} className={TONE_ICON.danger} />
      {`${engine}: not read`}
    </li>
  )
}
