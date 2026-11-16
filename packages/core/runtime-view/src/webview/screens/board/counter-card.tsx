import { Button, Icon, TONE_ICON } from "@miragon/pulse-ui"
import { TriangleAlertIcon } from "lucide-react"
import type { BoardTarget, CounterReadingData, CounterTile } from "../../../core/protocol/index.js"
import { CountLabels } from "../../format/count-labels.js"
import {
  BOARD_LINE,
  BOARD_LINE_BUTTON,
  BoardCard,
  BoardFigure,
  type BoardCallbacks,
} from "./board-card.js"
import { BoardLabels } from "./board-labels.js"

export interface CounterCardProps extends Pick<BoardCallbacks, "onOpen"> {
  readonly tile: CounterTile
}

interface EntryProps {
  readonly reading: CounterReadingData
  readonly incident: boolean
}

interface OpenableEntryProps extends EntryProps, Pick<BoardCallbacks, "onOpen"> {
  readonly target: BoardTarget | undefined
}

function EntryText({ reading, incident }: EntryProps) {
  const count = reading.count
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{reading.engine}</span>
      <BoardFigure
        text={BoardLabels.entryCount(count)}
        part="counter-count"
        alarm={incident && count !== undefined && count.count > 0}
        quiet={count === undefined}
      />
      {reading.above === true && <Icon icon={TriangleAlertIcon} className={TONE_ICON.warning} />}
    </>
  )
}

function EntryButton({
  reading,
  incident,
  target,
  onOpen,
}: EntryProps & Pick<BoardCallbacks, "onOpen"> & { readonly target: BoardTarget }) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={BOARD_LINE_BUTTON}
      title={BoardLabels.openTitle(target)}
      onClick={(event) => {
        onOpen(target, event.ctrlKey || event.metaKey)
      }}
    >
      <EntryText reading={reading} incident={incident} />
    </Button>
  )
}

function Entry({ reading, incident, target, onOpen }: OpenableEntryProps) {
  return (
    <li data-part="counter-entry" data-state={reading.above === true ? "above" : undefined}>
      {reading.count === undefined || target === undefined ? (
        <span className={BOARD_LINE}>
          <EntryText reading={reading} incident={incident} />
        </span>
      ) : (
        <EntryButton reading={reading} incident={incident} target={target} onOpen={onOpen} />
      )}
    </li>
  )
}

function Threshold({ tile }: { readonly tile: CounterTile }) {
  const warnAbove = tile.widget.warnAbove
  if (warnAbove === undefined) {
    return null
  }
  const warning = BoardLabels.warning(tile)
  if (warning === undefined) {
    return (
      <span
        className="text-muted-foreground"
        data-part="counter-threshold"
      >{`warns above ${CountLabels.exact(warnAbove)}`}</span>
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

export function CounterCard({ tile, onOpen }: CounterCardProps) {
  const partial = BoardLabels.partial(tile)
  const incident = tile.widget.filter.withIncident === true
  const total = tile.total
  return (
    <BoardCard title={BoardLabels.title(tile)} kind="counter">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BoardFigure
          text={BoardLabels.count(total)}
          part="counter-value"
          alarm={incident && total !== undefined && total.count > 0}
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
        {tile.readings.map((reading) => (
          <Entry
            key={reading.engine}
            reading={reading}
            incident={incident}
            target={tile.targets.find((target) => target.engine === reading.engine)}
            onOpen={onOpen}
          />
        ))}
      </ul>
    </BoardCard>
  )
}
