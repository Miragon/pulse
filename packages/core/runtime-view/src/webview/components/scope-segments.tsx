import { useState } from "preact/hooks"
import { CountLabels } from "../format/count-labels.js"
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
  readonly busy: boolean
  readonly notes?: Partial<Readonly<Record<Scope, string>>> | undefined
  readonly onSelect: (scope: Scope) => void
}

function ScopeCount({ alarming, count }: { readonly alarming: boolean; readonly count: number }) {
  return (
    <span
      class={alarming ? "segmented__count segmented__count--danger" : "segmented__count"}
      title={CountLabels.exact(count)}
    >
      {CountLabels.compact(count)}
    </span>
  )
}

interface PendingSelection<Scope extends string> {
  readonly from: Scope
  readonly to: Scope
}

export function ScopeSegments<Scope extends string>(props: ScopeSegmentsProps<Scope>) {
  const [pending, setPending] = useState<PendingSelection<Scope> | undefined>(undefined)
  const scope = pending?.from === props.checked ? pending.to : props.checked
  const select = (next: Scope): void => {
    setPending({ from: props.checked, to: next })
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
            <ScopeCount alarming={option.scope === "withIncident" && count > 0} count={count} />
          </button>
        )
      })}
    </div>
  )
}
