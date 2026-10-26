import type { BoardTarget, CounterEntry, CounterTile } from "../../../core/protocol/index.js"
import { Icon } from "../../components/icon.js"
import { glyphs } from "../../components/lucide-glyphs.json"
import { CountLabels } from "../../format/count-labels.js"
import { BoardCard } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"
import { useOpenTarget } from "./open-target.js"

interface EntryProps {
  readonly entry: CounterEntry
  readonly incident: boolean
}

function EntryText({ entry, incident }: EntryProps) {
  const danger = incident && entry.count !== undefined && entry.count > 0
  const tone = entry.count === undefined ? " muted" : danger ? " danger-count" : ""
  return (
    <>
      <span class="counter__engine-name">{entry.engine}</span>
      <span class={`counter__engine-count${tone}`}>{BoardLabels.entryCount(entry.count)}</span>
      {entry.above === true && <Icon of={glyphs.TriangleAlert} />}
    </>
  )
}

function EntryButton({ entry, incident, target }: EntryProps & { readonly target: BoardTarget }) {
  const open = useOpenTarget()
  return (
    <button
      type="button"
      class="counter__engine"
      title={BoardLabels.openTitle(target)}
      onClick={(event) => {
        open(target, event.ctrlKey || event.metaKey)
      }}
    >
      <EntryText entry={entry} incident={incident} />
    </button>
  )
}

function Entry({ entry, incident }: EntryProps) {
  const above = entry.above === true ? " counter__entry--above" : ""
  return (
    <li class={`counter__entry${above}`}>
      {entry.count === undefined || entry.target === undefined ? (
        <span class="counter__engine counter__engine--static">
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
  const above = BoardLabels.above(tile)
  if (above === undefined) {
    return (
      <span class="counter__threshold">{`warns above ${CountLabels.exact(tile.warnAbove)}`}</span>
    )
  }
  return (
    <span class="counter__threshold counter__threshold--above">
      <Icon of={glyphs.TriangleAlert} />
      {above}
    </span>
  )
}

export function CounterCard({ tile }: { readonly tile: CounterTile }) {
  const partial = BoardLabels.partial(tile)
  const incident = tile.incident === true
  const danger = incident && tile.total !== undefined && tile.total > 0
  return (
    <BoardCard title={tile.title} kind="counter">
      <p class="counter__total">
        <span class={`counter__value${danger ? " danger-count" : ""}`}>
          {BoardLabels.count(tile.total)}
        </span>
        {partial !== undefined && <span class="counter__partial">{partial}</span>}
        <Threshold tile={tile} />
      </p>
      <ul class="counter__entries" aria-label="Per engine">
        {tile.entries.map((entry) => (
          <Entry key={entry.engine} entry={entry} incident={incident} />
        ))}
      </ul>
    </BoardCard>
  )
}
