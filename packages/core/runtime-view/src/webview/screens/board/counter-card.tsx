import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import { TriangleAlertIcon } from "lucide-react"
import type { BoardTarget, CounterEntry, CounterTile } from "../../../core/protocol/index.js"
import { CountLabels } from "../../format/count-labels.js"
import { BOARD_LINE, BOARD_LINE_BUTTON, BoardCard, BoardFigure } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"
import { useOpenTarget } from "./open-target.js"

interface EntryProps {
  readonly entry: CounterEntry
  readonly incident: boolean
}

function EntryText({ entry, incident }: EntryProps) {
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{entry.engine}</span>
      <BoardFigure
        text={BoardLabels.entryCount(entry.count, entry.atLeast === true)}
        part="counter-count"
        alarm={incident && entry.count !== undefined && entry.count > 0}
        quiet={entry.count === undefined}
      />
      {entry.above === true && <Icon icon={TriangleAlertIcon} className={TONE_ICON.warning} />}
    </>
  )
}

function EntryButton({ entry, incident, target }: EntryProps & { readonly target: BoardTarget }) {
  const open = useOpenTarget()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={BOARD_LINE_BUTTON}
      title={BoardLabels.openTitle(target)}
      onClick={(event) => {
        open(target, event.ctrlKey || event.metaKey)
      }}
    >
      <EntryText entry={entry} incident={incident} />
    </Button>
  )
}

function Entry({ entry, incident }: EntryProps) {
  return (
    <li data-part="counter-entry" data-state={entry.above === true ? "above" : undefined}>
      {entry.count === undefined || entry.target === undefined ? (
        <span className={BOARD_LINE}>
          <EntryText entry={entry} incident={incident} />
        </span>
      ) : (
        <EntryButton entry={entry} incident={incident} target={entry.target} />
      )}
    </li>
  )
}

function Threshold({ tile }: { readonly tile: CounterTile }) {
  if (tile.warnAbove === undefined) {
    return null
  }
  const warning = BoardLabels.warning(tile)
  if (warning === undefined) {
    return (
      <span
        className="text-muted-foreground"
        data-part="counter-threshold"
      >{`warns above ${CountLabels.exact(tile.warnAbove)}`}</span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-part="counter-threshold"
      data-state={BoardLabels.above(tile) === undefined ? "undecided" : "above"}
    >
      <Icon icon={TriangleAlertIcon} className={TONE_ICON.warning} />
      {warning}
    </span>
  )
}

export function CounterCard({ tile }: { readonly tile: CounterTile }) {
  const partial = BoardLabels.partial(tile)
  const incident = tile.incident === true
  return (
    <BoardCard title={tile.title} kind="counter">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BoardFigure
          text={BoardLabels.count(tile.total, tile.totalAtLeast === true)}
          part="counter-value"
          alarm={incident && tile.total !== undefined && tile.total > 0}
          className="text-title"
        />
        {partial !== undefined && (
          <span className="text-muted-foreground" data-part="counter-partial">
            {partial}
          </span>
        )}
        <Threshold tile={tile} />
      </p>
      <ul className="flex flex-col" aria-label="Per engine">
        {tile.entries.map((entry) => (
          <Entry key={entry.engine} entry={entry} incident={incident} />
        ))}
      </ul>
    </BoardCard>
  )
}
