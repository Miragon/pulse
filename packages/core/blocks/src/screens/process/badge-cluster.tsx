import type { ComponentType } from "react"
import { formatCompactCount, formatCount } from "@miragon/pulse-ui"
import {
  DiagramDecorations,
  type BadgeCountData,
  type ElementBadgeData,
  type InstanceScopeCode,
} from "@miragon/pulse-screens"
import { useProcessWords, type ProcessWords } from "../../messages/process-words.js"
import type { CountBadgeProps, ScreenOpenHow } from "../slots.js"

export interface BadgeClusterProps {
  /** The element's counts, the process screen's badge of it (`DiagramDecorations` orders them). */
  readonly badge: ElementBadgeData
  /** The element's name, as the surface knows it (else its id). */
  readonly elementName: string
  /** The counts are older than the list under them (a refresh runs). */
  readonly stale?: boolean
  /** A count's click: the list filtered to the element and the count's scope. */
  readonly onSelect: (elementId: string, scope: InstanceScopeCode, how: ScreenOpenHow) => void
  /** The surface's count badge, as its diagram draws one. */
  readonly Badge: ComponentType<CountBadgeProps>
}

/** What a count says, its action included: "Ship order: 1 incident. Show the instances …". */
function descriptionOf(t: ProcessWords, element: string, { kind, count }: BadgeCountData) {
  return t(`badge.${kind}`, { element, count: formatCount(count) })
}

/** A count's accessible name: its description, led by the count it shows where it does not say it. */
function nameOf(t: ProcessWords, element: string, count: BadgeCountData) {
  const description = descriptionOf(t, element, count)
  const shown = formatCompactCount(count.count)
  return description.includes(shown) ? description : t("badge.named", { shown, description })
}

/**
 * The counts on an element of a process's diagram, apart: its root incidents, the incidents in the
 * instances it called (never part of the incident count), its running instances. Each is a button
 * that filters the instance list to the element and the count's scope; the surface draws the badge.
 */
export function BadgeCluster(props: BadgeClusterProps) {
  const { badge, elementName, stale = false, onSelect, Badge } = props
  const { elementId } = badge
  const t = useProcessWords()
  const [decoration] = DiagramDecorations.of({ badges: [badge], calls: [] })
  return (
    <span
      className="badge-cluster"
      role="group"
      aria-label={elementName}
      data-badge-for={elementId}
    >
      {decoration?.counts.map((count) => (
        <button
          key={count.kind}
          type="button"
          className="badge-cluster__count"
          data-part="badge-count"
          data-scope={count.scope}
          aria-label={nameOf(t, elementName, count)}
          title={descriptionOf(t, elementName, count)}
          onClick={(event) => {
            event.stopPropagation()
            onSelect(elementId, count.scope, { toSide: event.ctrlKey || event.metaKey })
          }}
        >
          <Badge kind={count.kind} count={count.count} stale={stale} />
        </button>
      ))}
    </span>
  )
}
