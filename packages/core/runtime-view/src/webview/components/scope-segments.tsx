import { CountLabels } from "../format/count-labels.js"
import { usePendingValue } from "./pending-value.js"
import { RovingKeys } from "./roving-keys.js"

export interface ScopeOption<Scope extends string> {
  readonly scope: Scope
  readonly label: string
}

export interface ScopeSegmentsProps<Scope extends string> {
  readonly label: string
  readonly options: readonly ScopeOption<Scope>[]
  readonly checked: Scope
  readonly counts: Readonly<Record<Scope, number>>
  readonly atLeast?: readonly Scope[] | undefined
  readonly busy: boolean
  readonly notes?: Partial<Readonly<Record<Scope, string>>> | undefined
  readonly onSelect: (scope: Scope) => void
}

interface ScopeCountProps {
  readonly alarming: boolean
  readonly count: number
  readonly atLeast: boolean
}

function ScopeCount({ alarming, count, atLeast }: ScopeCountProps) {
  return (
    <span
      class={alarming ? "segmented__count segmented__count--danger" : "segmented__count"}
      data-part="segment-count"
      data-tone={alarming ? "danger" : undefined}
      title={CountLabels.exact(count, atLeast)}
    >
      {CountLabels.compact(count, atLeast)}
    </span>
  )
}

export function ScopeSegments<Scope extends string>(props: ScopeSegmentsProps<Scope>) {
  const [scope, setPending] = usePendingValue(props.checked)
  const select = (next: Scope): void => {
    setPending(next)
    props.onSelect(next)
  }
  const scopes = props.options.map((option) => option.scope)
  return (
    <div
      class="segmented"
      role="radiogroup"
      aria-label={props.label}
      aria-busy={props.busy}
      onKeyDown={(event) => {
        RovingKeys.move(event, scopes, select)
      }}
    >
      {props.options.map((option) => {
        const count = props.counts[option.scope]
        return (
          <button
            key={option.scope}
            type="button"
            role="radio"
            class="segmented__option"
            data-key={option.scope}
            title={props.notes?.[option.scope]}
            aria-checked={option.scope === scope}
            tabIndex={option.scope === scope ? 0 : -1}
            onClick={() => {
              select(option.scope)
            }}
          >
            {`${option.label} `}
            <ScopeCount
              alarming={option.scope === "withIncident" && count > 0}
              count={count}
              atLeast={props.atLeast?.includes(option.scope) === true}
            />
          </button>
        )
      })}
    </div>
  )
}
