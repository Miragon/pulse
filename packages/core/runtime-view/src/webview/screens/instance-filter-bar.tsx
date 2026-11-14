import { Toolbar } from "@miragon/pulse-ui"
import type {
  InstanceListFilter,
  RefusedVariableCondition,
  ScopeCounts,
} from "../../core/protocol/index.js"
import { ScopeSegments } from "../components/scope-segments.js"
import { SearchField } from "../components/search-field.js"
import { DiagramLegend } from "../diagram/diagram-legend.js"
import { ElementChip } from "./element-chip.js"
import { InstanceFilter, SCOPE_OPTIONS } from "./instance-filter.js"
import { VariableChips } from "./variable-chips.js"

export interface InstanceFilterBarProps {
  readonly filter: InstanceListFilter
  readonly counts: ScopeCounts
  readonly refreshing: boolean
  readonly version: number
  readonly historyNote?: string | undefined
  readonly variableLabels?: readonly string[] | undefined
  readonly variableNames?: readonly string[] | undefined
  readonly refusedConditions?: readonly RefusedVariableCondition[] | undefined
  readonly elementName: (elementId: string) => string
  readonly onFilter: (filter: InstanceListFilter) => void
}

const NARROW = {
  scope: "flex min-w-0 items-center",
  legend: "ml-auto flex items-center @max-[47.5rem]/bar:order-1",
  wrap: "hidden h-0 basis-full @max-[47.5rem]/bar:order-2 @max-[47.5rem]/bar:block",
  chip: "@max-[47.5rem]/bar:order-3 @max-[47.5rem]/bar:max-w-1/2",
  search:
    "flex min-w-0 @max-[47.5rem]/bar:order-4 @max-[47.5rem]/bar:flex-1 @max-[47.5rem]/bar:[&>*]:flex-1",
} as const

export function InstanceFilterBar(props: InstanceFilterBarProps) {
  const { filter, onFilter } = props
  return (
    <div className="contents" data-part="filter-bar">
      <Toolbar>
        <div className={NARROW.scope}>
          <ScopeSegments
            label="Show instances"
            options={SCOPE_OPTIONS}
            checked={filter.scope}
            counts={props.counts}
            atLeast={props.counts.atLeast}
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
        </div>
        <ElementChip
          filter={filter}
          elementName={props.elementName}
          onFilter={onFilter}
          className={NARROW.chip}
        />
        <div className={NARROW.search}>
          <SearchField
            applied={filter.businessKey ?? ""}
            label="Search by business key"
            placeholder="Business key"
            onSearch={(text) => {
              onFilter(InstanceFilter.withBusinessKey(filter, text))
            }}
          />
        </div>
        <VariableChips
          filter={filter}
          labels={props.variableLabels}
          names={props.variableNames}
          refused={props.refusedConditions}
          onFilter={onFilter}
        />
        <div className={NARROW.legend}>
          <DiagramLegend
            kind="badges"
            scope={`Badges count running instances of v${props.version}`}
          />
        </div>
        <span aria-hidden="true" className={NARROW.wrap} />
      </Toolbar>
    </div>
  )
}
