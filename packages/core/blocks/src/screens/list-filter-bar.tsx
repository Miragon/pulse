import { CircleXIcon } from "lucide-react"
import {
  Icon,
  SearchField,
  SegmentedControl,
  TONE_ICON,
  Toolbar,
  cn,
  formatCompactCount,
  formatCount,
} from "@miragon/pulse-ui"
import type {
  EngineTotalsData,
  ProcessFilterData,
  ProcessScope,
  ProcessScopeCounts,
} from "@miragon/pulse-screens"
import type { ScreenWordKey } from "../messages/screen-en.js"
import { useScreenWords } from "../messages/screen-words.js"

/** A search applies once the typing pauses this long, or at once on Enter. */
const SEARCH_DELAY_MS = 400

const SCOPES = [
  { scope: "all", word: "processes.scope.all" },
  { scope: "withIncident", word: "processes.scope.withIncident" },
] as const satisfies readonly { readonly scope: ProcessScope; readonly word: ScreenWordKey }[]

export interface ListFilterBarProps {
  /** The filter the list shows. */
  readonly filter: ProcessFilterData
  /** How many processes each scope holds under the search (`useProcessList`). */
  readonly counts: ProcessScopeCounts
  /** The engine screen's totals over every process, which the bar sums up at its end. */
  readonly totals: EngineTotalsData
  /** While the surface reads again: the scopes say so, and a pick shows until it lands. */
  readonly busy?: boolean
  /** The filter a pick of a scope or a search asks for. */
  readonly onFilter: (filter: ProcessFilterData) => void
}

/** A scope's count: compact, exact in its title, the alarm icon on instances with incident. */
function ScopeCount({ count, alarming }: { readonly count: number; readonly alarming: boolean }) {
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 font-normal tabular-nums"
      data-part="segment-count"
      data-tone={alarming ? "danger" : undefined}
      title={formatCount(count)}
    >
      {alarming && <Icon icon={CircleXIcon} className={cn(TONE_ICON.danger)} />}
      {formatCompactCount(count)}
    </span>
  )
}

/**
 * The bar over an engine's process list: the scopes, every process or those with an instance with
 * incident, each with its count, a search over the process's name or BPMN process ID, and the
 * engine's totals over every version. It asks for a filter and reads nothing: the surface lists
 * the rows (`useProcessList` in the browser, the editors' core with the same rule).
 */
export function ListFilterBar({ filter, counts, totals, busy, onFilter }: ListFilterBarProps) {
  const t = useScreenWords()
  const { scope } = filter
  return (
    <div className="contents" data-part="filter-bar">
      <Toolbar
        summary={t("processes.summary", {
          processes: formatCount(totals.processes),
          running: formatCount(totals.running),
          withIncident: formatCount(totals.withIncident),
        })}
      >
        <SegmentedControl<ProcessScope>
          ariaLabel={t("processes.scopes")}
          value={scope}
          {...(busy === undefined ? {} : { busy })}
          onChange={(next) => {
            onFilter({ ...filter, scope: next })
          }}
          options={SCOPES.map(({ scope: option, word }) => ({
            value: option,
            label: (
              <>
                {`${t(word)} `}
                <ScopeCount
                  count={counts[option]}
                  alarming={option === "withIncident" && counts[option] > 0}
                />
              </>
            ),
          }))}
        />
        <SearchField
          value={filter.search ?? ""}
          onChange={(search) => {
            onFilter(search === "" ? { scope } : { scope, search })
          }}
          delayMs={SEARCH_DELAY_MS}
          placeholder={t("processes.searchPlaceholder")}
          aria-label={t("processes.search")}
        />
      </Toolbar>
    </div>
  )
}
