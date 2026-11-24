import type { ReactNode } from "react"
import type { MigrationPlanView } from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { EmptyHint } from "../components/empty-hint.js"

export interface MigrationPlanScreenProps {
  readonly view: MigrationPlanView
  readonly freshness: Freshness
  readonly stale: boolean
  readonly problem?: ReactNode
}

export function MigrationPlanScreen({ view, freshness, problem }: MigrationPlanScreenProps) {
  return (
    <div className="grid h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <ContextBar
        subject="migration"
        title={view.processName}
        engine={view.engine}
        freshness={freshness}
      />
      <div className="flex min-w-0 flex-col" data-part="strips">
        {problem}
      </div>
      <div className="bg-background grid place-items-center">
        <EmptyHint text={view.verdict.text} />
      </div>
    </div>
  )
}
