import type { ReactNode } from "react"
import { SearchField, Toolbar } from "@miragon/pulse-ui"
import type {
  InstanceListFilterData,
  InstanceScopeCode,
  ScopeCountsData,
} from "@miragon/pulse-screens"
import type { ProcessWordKey } from "../../messages/process-en.js"
import { useProcessWords } from "../../messages/process-words.js"
import { ElementChip } from "./element-chip.js"
import { InstanceFilters } from "./instance-filters.js"
import { ScopeSegments } from "../scope-segments.js"
import { VariableChips, type VariableFilterProps } from "./variable-chips.js"

/** A search applies once the typing pauses this long, or at once on Enter. */
const SEARCH_DELAY_MS = 400

const SCOPES = [
  { scope: "running", word: "scope.running" },
  { scope: "withIncident", word: "scope.withIncident" },
  { scope: "ended", word: "scope.ended" },
  { scope: "all", word: "scope.all" },
] as const satisfies readonly { readonly scope: InstanceScopeCode; readonly word: ProcessWordKey }[]

/** Where the bar's parts go in a narrow bar: the scopes and the legend first, then the rest. */
const NARROW = {
  scope: "flex min-w-0 items-center",
  legend: "ml-auto flex items-center @max-[47.5rem]/bar:order-1",
  wrap: "hidden h-0 basis-full @max-[47.5rem]/bar:order-2 @max-[47.5rem]/bar:block",
  chip: "@max-[47.5rem]/bar:order-3 @max-[47.5rem]/bar:max-w-1/2",
  search:
    "flex min-w-0 @max-[47.5rem]/bar:order-4 @max-[47.5rem]/bar:flex-1 @max-[47.5rem]/bar:[&>*]:flex-1",
} as const

export interface InstanceFilterBarProps {
  /** The filter the list shows. */
  readonly filter: InstanceListFilterData
  /** How many instances each scope holds, a count the engine stopped at as a lower bound. */
  readonly counts: ScopeCountsData
  /** While the surface reads again: the scopes say so, and a pick shows until it lands. */
  readonly busy: boolean
  /** What the surface says of the ended and all counts, their segments' title (the editors: when they update). */
  readonly historyNote?: string | undefined
  /** An element's name, as the surface knows it (else its id), for the element's chip. */
  readonly elementName: (elementId: string) => string
  /** The variable conditions' words, the engine's variable names and the kinds it refuses. */
  readonly variables?: VariableFilterProps | undefined
  /** The surface's legend of its diagram (the blocks' `BadgeLegend`), at the bar's end. */
  readonly legend?: ReactNode
  /** The filter a pick of a scope, a search, a chip or a condition asks for. */
  readonly onFilter: (filter: InstanceListFilterData) => void
}

/**
 * The bar over a process's instance list: the scopes running, with incident, ended and all with
 * their counts, the chip of the element the list is filtered to, a search for the exact business
 * key, the variable conditions and the surface's legend. It asks for a filter and reads nothing.
 */
export function InstanceFilterBar(props: InstanceFilterBarProps) {
  const { filter, counts, historyNote, onFilter } = props
  const t = useProcessWords()
  return (
    <div className="contents" data-part="filter-bar">
      <Toolbar>
        <div className={NARROW.scope}>
          <ScopeSegments<InstanceScopeCode>
            label={t("scopes.label")}
            options={SCOPES.map(({ scope, word }) => ({ scope, label: t(word) }))}
            checked={filter.scope}
            counts={counts}
            atLeast={counts.atLeast}
            busy={props.busy}
            notes={historyNote === undefined ? undefined : { ended: historyNote, all: historyNote }}
            onSelect={(scope) => {
              onFilter(InstanceFilters.withScope(filter, scope))
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
            value={filter.businessKey ?? ""}
            onChange={(text) => {
              onFilter(InstanceFilters.withBusinessKey(filter, text))
            }}
            delayMs={SEARCH_DELAY_MS}
            placeholder={t("businessKey.placeholder")}
            aria-label={t("businessKey.search")}
          />
        </div>
        <VariableChips {...props.variables} filter={filter} onFilter={onFilter} />
        <div className={NARROW.legend}>{props.legend}</div>
        <span aria-hidden="true" className={NARROW.wrap} />
      </Toolbar>
    </div>
  )
}
