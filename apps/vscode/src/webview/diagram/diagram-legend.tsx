import { glyphs } from "../components/lucide-glyphs.json"
import { CountBadge } from "../components/count-badge.js"
import { Icon } from "../components/icon.js"

type LegendKind = "badges" | "markers"

type Entry = readonly [sign: string, text: string]

const ENTRIES: Readonly<Record<LegendKind, readonly Entry[]>> = {
  badges: [
    ["running", "waiting here"],
    ["incident", "incident here"],
    ["propagated", "incident in a called instance"],
  ],
  markers: [
    ["waiting", "waiting here"],
    ["incident", "incident here"],
    ["called", "incident in a called instance"],
    ["completed", "already done; green lines are the flows it took"],
  ],
}

function Sign({ kind, sign }: { readonly kind: LegendKind; readonly sign: string }) {
  return kind === "badges" ? (
    <CountBadge variant={sign as "running" | "incident" | "propagated"} />
  ) : (
    <span class={`legend-swatch legend-swatch--${sign}`} aria-hidden="true" />
  )
}

export interface DiagramLegendProps {
  readonly kind: LegendKind
  readonly scope?: string
}

export function DiagramLegend({ kind, scope }: DiagramLegendProps) {
  const entries = ENTRIES[kind]
  return (
    <div class={`legend legend--${kind}`}>
      <button
        type="button"
        class="icon-button icon-button--small legend__toggle"
        popovertarget="legend"
        aria-label="Legend"
        title="Legend"
      >
        <Icon of={glyphs.CircleQuestionMark} />
      </button>
      <div id="legend" popover="auto" class="legend__popover">
        {scope !== undefined && <p>{scope}.</p>}
        {entries.map(([sign, text]) => (
          <p key={sign} class="legend__item">
            <Sign kind={kind} sign={sign} />
            {text}
          </p>
        ))}
      </div>
    </div>
  )
}
