import { Button, Icon, TONE_ICON, formatCount } from "@miragon/pulse-ui"
import { TriangleAlertIcon } from "lucide-react"
import type { CounterData, CounterReadingData } from "@miragon/pulse-board"
import { useWords } from "../messages/translate.js"
import { BOARD_LINE, BOARD_LINE_BUTTON, BoardCard, BoardFigure } from "./board-card.js"
import type { BoardInstancesTarget, BoardSlots } from "./slots.js"
import { counterTarget, openable } from "./targets.js"
import {
  above,
  entryCount,
  openTitle,
  partial,
  tileTitle,
  totalCount,
  warning,
} from "./tile-words.js"

export interface CounterTileProps {
  readonly tile: CounterData
  readonly slots: Pick<BoardSlots, "onOpen" | "opens" | "opensToSide">
}

interface EntryProps {
  readonly reading: CounterReadingData
  readonly incident: boolean
}

interface OpenableEntryProps extends EntryProps {
  readonly target: BoardInstancesTarget | undefined
  readonly slots: CounterTileProps["slots"]
}

function EntryText({ reading, incident }: EntryProps) {
  const t = useWords()
  const count = reading.count
  return (
    <>
      <span className="min-w-0 flex-1 truncate">{reading.engine}</span>
      <BoardFigure
        text={entryCount(t, count)}
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
  slots,
}: EntryProps & {
  readonly target: BoardInstancesTarget
  readonly slots: OpenableEntryProps["slots"]
}) {
  const t = useWords()
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className={BOARD_LINE_BUTTON}
      title={openTitle(t, target, slots.opensToSide === true)}
      onClick={(event) => {
        slots.onOpen(target, { toSide: event.ctrlKey || event.metaKey })
      }}
    >
      <EntryText reading={reading} incident={incident} />
    </Button>
  )
}

function Entry({ reading, incident, target, slots }: OpenableEntryProps) {
  return (
    <li data-part="counter-entry" data-state={reading.above === true ? "above" : undefined}>
      {reading.count === undefined || target === undefined ? (
        <span className={BOARD_LINE}>
          <EntryText reading={reading} incident={incident} />
        </span>
      ) : (
        <EntryButton reading={reading} incident={incident} target={target} slots={slots} />
      )}
    </li>
  )
}

function Threshold({ tile }: { readonly tile: CounterData }) {
  const t = useWords()
  const warnAbove = tile.widget.warnAbove
  if (warnAbove === undefined) {
    return null
  }
  const warned = warning(t, tile)
  if (warned === undefined) {
    return (
      <span className="text-muted-foreground" data-part="counter-threshold">
        {t("counter.warnsAbove", { limit: formatCount(warnAbove) })}
      </span>
    )
  }
  return (
    <span
      className="inline-flex items-center gap-1.5"
      data-part="counter-threshold"
      data-state={above(t, tile) === undefined ? "undecided" : "above"}
    >
      <Icon icon={TriangleAlertIcon} className={TONE_ICON.warning} />
      {warned}
    </span>
  )
}

/** A counter: its total, how many engines it comes from, its threshold and each engine's count. */
export function CounterTile({ tile, slots }: CounterTileProps) {
  const t = useWords()
  const shown = partial(t, tile)
  const incident = tile.widget.filter.withIncident === true
  const total = tile.total
  return (
    <BoardCard title={tileTitle(t, tile)} kind="counter">
      <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <BoardFigure
          text={totalCount(total)}
          part="counter-value"
          alarm={incident && total !== undefined && total.count > 0}
          className="text-title"
        />
        {shown !== undefined && (
          <span className="text-muted-foreground" data-part="counter-partial">
            {shown}
          </span>
        )}
        <Threshold tile={tile} />
      </p>
      <ul className="flex flex-col" aria-label={t("perEngine")}>
        {tile.readings.map((reading) => (
          <Entry
            key={reading.engine}
            reading={reading}
            incident={incident}
            target={openable(slots, counterTarget(reading.engine, tile.widget.filter))}
            slots={slots}
          />
        ))}
      </ul>
    </BoardCard>
  )
}
