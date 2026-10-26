import { glyphs } from "../components/lucide-glyphs.json"
import type { InstanceListFilter, ScopeCounts } from "../../core/protocol/index.js"
import { Icon } from "../components/icon.js"
import { ScopeSegments } from "../components/scope-segments.js"
import { SearchField } from "../components/search-field.js"
import { DiagramLegend } from "../diagram/diagram-legend.js"
import { InstanceFilter, SCOPE_OPTIONS } from "./instance-filter.js"

export interface InstanceFilterBarProps {
  readonly filter: InstanceListFilter
  readonly counts: ScopeCounts
  readonly refreshing: boolean
  readonly version: number
  readonly historyNote?: string | undefined
  readonly elementName: (elementId: string) => string
  readonly onFilter: (filter: InstanceListFilter) => void
}

function ElementChip({ filter, elementName, onFilter }: InstanceFilterBarProps) {
  if (filter.elementId === undefined) {
    return null
  }
  const name = elementName(filter.elementId)
  return (
    <span class="filter-chip" title={`At ${name}`}>
      <span class="filter-chip__name">
        <span class="muted">At</span> {name}
      </span>
      <button
        type="button"
        class="icon-button icon-button--small"
        aria-label="Clear element filter"
        onClick={() => {
          onFilter(InstanceFilter.withoutElement(filter))
        }}
      >
        <Icon of={glyphs.X} />
      </button>
    </span>
  )
}

export function InstanceFilterBar(props: InstanceFilterBarProps) {
  const { filter, onFilter } = props
  return (
    <div class="filter-bar">
      <ScopeSegments
        label="Show instances"
        options={SCOPE_OPTIONS}
        checked={filter.scope}
        counts={props.counts}
        busy={props.refreshing}
        notes={
          props.historyNote === undefined
            ? undefined
            : { ended: props.historyNote, all: props.historyNote }
        }
        onSelect={(scope) => {
          onFilter(InstanceFilter.withScope(filter, scope))
        }}
      />
      <ElementChip {...props} />
      <SearchField
        applied={filter.businessKey ?? ""}
        label="Search by business key"
        placeholder="Business key"
        onSearch={(text) => {
          onFilter(InstanceFilter.withBusinessKey(filter, text))
        }}
      />
      <DiagramLegend kind="badges" scope={`Badges count running instances of v${props.version}`} />
    </div>
  )
}
