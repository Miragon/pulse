import { CircleXIcon } from "lucide-react"
import { Icon, SegmentedControl, TONE_ICON, cn } from "@miragon/pulse-ui"
import { CountLabels } from "../format/count-labels.js"

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
      className="text-muted-foreground inline-flex items-center gap-1 font-normal tabular-nums"
      data-part="segment-count"
      data-tone={alarming ? "danger" : undefined}
      title={CountLabels.exact(count, atLeast)}
    >
      {alarming && <Icon icon={CircleXIcon} className={cn(TONE_ICON.danger)} />}
      {CountLabels.compact(count, atLeast)}
    </span>
  )
}

export function ScopeSegments<Scope extends string>(props: ScopeSegmentsProps<Scope>) {
  return (
    <SegmentedControl<Scope>
      ariaLabel={props.label}
      value={props.checked}
      busy={props.busy}
      onChange={props.onSelect}
      options={props.options.map((option) => {
        const count = props.counts[option.scope]
        const note = props.notes?.[option.scope]
        return {
          value: option.scope,
          ...(note === undefined ? {} : { note }),
          label: (
            <>
              {`${option.label} `}
              <ScopeCount
                alarming={option.scope === "withIncident" && count > 0}
                count={count}
                atLeast={props.atLeast?.includes(option.scope) === true}
              />
            </>
          ),
        }
      })}
    />
  )
}
