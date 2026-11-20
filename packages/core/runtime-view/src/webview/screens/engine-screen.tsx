import { ListFilterBar, ProcessTable } from "@miragon/pulse-blocks"
import { RotateCcwIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { EngineView } from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { HeaderButton } from "../components/header-button.js"
import { WebUiButton } from "../components/web-ui-button.js"
import { useHost } from "../host/host-context.js"
import { useProcessSlots } from "./process-slots.js"
import { ScreenFrame } from "./screen-frame.js"

export interface EngineScreenProps {
  readonly view: EngineView
  readonly freshness: Freshness
  readonly problem?: ReactNode
}

function ProcessList({
  view,
  refreshing,
}: {
  readonly view: EngineView
  readonly refreshing: boolean
}) {
  const host = useHost()
  const slots = useProcessSlots()
  return (
    <section className={ScreenFrame.LIST_REGION} aria-label="Process list">
      <ListFilterBar
        filter={view.filter}
        counts={view.scopeCounts}
        totals={view.totals}
        busy={refreshing}
        onFilter={(filter) => {
          host.post({ type: "filterProcesses", filter })
        }}
      />
      <ProcessTable
        engine={view.engine.name}
        listed={{ processes: view.processes, counts: view.scopeCounts }}
        filter={view.filter}
        totals={view.totals}
        slots={slots}
      />
    </section>
  )
}

export function EngineScreen({ view, freshness, problem }: EngineScreenProps) {
  return (
    <div className={ScreenFrame.WITH_STRIPS}>
      <ContextBar
        subject="engine"
        title={view.engine.name}
        engine={view.engine}
        freshness={freshness}
        actions={
          <>
            <HeaderButton
              icon={RotateCcwIcon}
              label="Refresh"
              title={`Read ${view.engine.name} again`}
              intent={{ type: "refresh" }}
            />
            <WebUiButton link={view.webUi} />
          </>
        }
      >
        {view.engine.product !== undefined && (
          <span className="min-w-0 truncate max-[900px]:hidden" data-part="context-key">
            {view.engine.product}
          </span>
        )}
      </ContextBar>
      <div className={ScreenFrame.STRIPS} data-part="strips">
        {problem}
      </div>
      <ProcessList view={view} refreshing={freshness.kind === "refreshing"} />
    </div>
  )
}
