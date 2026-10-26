import type { CounterEntry, CounterTile } from "../../../core/protocol/index.js"
import { Icon } from "../../components/icon.js"
import { glyphs } from "../../components/lucide-glyphs.json"
import { CountLabels } from "../../format/count-labels.js"
import { BoardCard } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"
import { useOpenTarget } from "./open-target.js"

function EntryButton({ entry }: { readonly entry: CounterEntry }) {
  const open = useOpenTarget()
  return (
    <li class={`counter__entry${entry.above === true ? " counter__entry--above" : ""}`}>
      <button
        type="button"
        class="counter__engine"
        title={
          entry.count === undefined
            ? `${entry.engine} could not be read`
            : `Open the process on ${entry.engine}, latest version first`
        }
        disabled={entry.count === undefined}
        onClick={(event) => {
          open(entry.target, event.ctrlKey || event.metaKey)
        }}
      >
        <span class="counter__engine-name">{entry.engine}</span>
        <span class="counter__engine-count">{BoardLabels.count(entry.count)}</span>
        {entry.above === true && <Icon of={glyphs.TriangleAlert} />}
      </button>
    </li>
  )
}

export function CounterCard({ tile }: { readonly tile: CounterTile }) {
  const partial = BoardLabels.partial(tile)
  const above = tile.entries.some((entry) => entry.above === true)
  return (
    <BoardCard title={tile.title} kind="counter">
      <p class={`counter__total${above ? " counter__total--above" : ""}`}>
        <span class="counter__value">{BoardLabels.count(tile.total)}</span>
        {partial !== undefined && <span class="counter__partial">{partial}</span>}
        {tile.warnAbove !== undefined && (
          <span class="counter__threshold">
            {above && <Icon of={glyphs.TriangleAlert} />}
            {above
              ? `above ${CountLabels.exact(tile.warnAbove)}`
              : `warns above ${CountLabels.exact(tile.warnAbove)}`}
          </span>
        )}
      </p>
      <ul class="counter__entries" aria-label="Per engine">
        {tile.entries.map((entry) => (
          <EntryButton key={entry.engine} entry={entry} />
        ))}
      </ul>
    </BoardCard>
  )
}
