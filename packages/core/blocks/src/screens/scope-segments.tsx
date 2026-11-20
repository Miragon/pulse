import { CircleXIcon } from "lucide-react"
import {
  Icon,
  SegmentedControl,
  TONE_ICON,
  cn,
  formatCompactCount,
  formatCount,
} from "@miragon/pulse-ui"

/** A scope of a list and the words its segment says. */
export interface ScopeOption<Scope extends string> {
  readonly scope: Scope
  readonly label: string
}

export interface ScopeSegmentsProps<Scope extends string> {
  /** Names the group of segments ("Show instances"). */
  readonly label: string
  readonly options: readonly ScopeOption<Scope>[]
  /** The scope the list shows. */
  readonly checked: Scope
  /** How many each scope holds. */
  readonly counts: Readonly<Record<Scope, number>>
  /** The scopes whose count is a lower bound: the engine stopped counting there. */
  readonly atLeast?: readonly Scope[] | undefined
  /** While the surface reads again: the group says so, and a pick shows until it lands. */
  readonly busy?: boolean | undefined
  /** A note per scope, its segment's title: what its count leaves out. */
  readonly notes?: Partial<Readonly<Record<Scope, string>>> | undefined
  readonly onSelect: (scope: Scope) => void
}

/** A scope's count: compact, exact in its title, a lower bound marked, the alarm icon above 0. */
function ScopeCount({
  count,
  alarming,
  atLeast,
}: {
  readonly count: number
  readonly alarming: boolean
  readonly atLeast: boolean
}) {
  const shown = atLeast ? { atLeast: count } : count
  return (
    <span
      className="text-muted-foreground inline-flex items-center gap-1 font-normal tabular-nums"
      data-part="segment-count"
      data-tone={alarming ? "danger" : undefined}
      title={formatCount(shown)}
    >
      {alarming && <Icon icon={CircleXIcon} className={cn(TONE_ICON.danger)} />}
      {formatCompactCount(shown)}
    </span>
  )
}

/**
 * The scopes of a list as one radio group, each segment with its words and its count (the one
 * with incident with the danger icon above 0, a count the engine stopped at as a lower bound). It
 * asks for a scope through `onSelect` and reads nothing.
 */
export function ScopeSegments<Scope extends string>(props: ScopeSegmentsProps<Scope>) {
  const { label, options, checked, counts, atLeast, busy, notes, onSelect } = props
  return (
    <SegmentedControl<Scope>
      ariaLabel={label}
      value={checked}
      {...(busy === undefined ? {} : { busy })}
      onChange={onSelect}
      options={options.map((option) => {
        const count = counts[option.scope]
        const note = notes?.[option.scope]
        return {
          value: option.scope,
          ...(note === undefined ? {} : { note }),
          label: (
            <>
              {`${option.label} `}
              <ScopeCount
                count={count}
                alarming={option.scope === "withIncident" && count > 0}
                atLeast={atLeast?.includes(option.scope) === true}
              />
            </>
          ),
        }
      })}
    />
  )
}
