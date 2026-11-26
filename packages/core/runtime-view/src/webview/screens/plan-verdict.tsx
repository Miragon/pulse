import { Icon, TONE_ICON, cn } from "@miragon/pulse-ui"
import { CircleXIcon } from "lucide-react"
import type { MigrationPlanView } from "../../core/protocol/index.js"

export function PlanVerdict({ view }: { readonly view: MigrationPlanView }) {
  const { verdict } = view
  const danger = !verdict.fits && verdict.checking !== true
  return (
    <div
      className="bg-card border-border px-gutter flex flex-none flex-col gap-1 border-t py-2"
      role="group"
      aria-label="Plan check"
    >
      <span className="text-muted-foreground" data-part="migration-summary">
        {view.summary}
      </span>
      <p
        className="flex min-w-0 items-start gap-1.5"
        data-part="plan-verdict"
        data-tone={danger ? "danger" : "neutral"}
        aria-live="polite"
        aria-busy={verdict.checking === true ? true : undefined}
      >
        {danger && <Icon icon={CircleXIcon} className={cn(TONE_ICON.danger, "mt-0.5 flex-none")} />}
        <span className="min-w-0">{verdict.text}</span>
      </p>
      <ul
        className="text-muted-foreground list-disc ps-5"
        data-part="plan-facts"
        aria-label={`Facts about a migration from v${view.source.version} to v${view.target.version}`}
      >
        {view.facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </div>
  )
}
