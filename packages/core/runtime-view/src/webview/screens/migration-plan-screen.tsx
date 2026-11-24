import { Icon } from "@miragon/pulse-ui"
import { FileCodeIcon, MoveRightIcon, RotateCcwIcon, WorkflowIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { MigrationPlanView, PlanSideView, WebviewIntent } from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { HeaderButton } from "../components/header-button.js"
import { CountLabels } from "../format/count-labels.js"
import { MigrationDiagrams } from "./migration-diagrams.js"
import { NoticeStrips } from "./notices.js"
import { PlanMappingTable } from "./plan-mapping-table.js"
import { PlanVerdict } from "./plan-verdict.js"
import { ScreenFrame } from "./screen-frame.js"
import { SplitLayout } from "./split-layout.js"

export interface MigrationPlanScreenProps {
  readonly view: MigrationPlanView
  readonly freshness: Freshness
  readonly stale: boolean
  readonly problem?: ReactNode
}

function OpenVersionButton({
  view,
  side,
}: {
  readonly view: MigrationPlanView
  readonly side: PlanSideView
}) {
  const intent: WebviewIntent = {
    type: "openDefinition",
    bpmnProcessId: view.bpmnProcessId,
    definitionId: side.definitionId,
  }
  return (
    <HeaderButton
      icon={WorkflowIcon}
      label={`Open v${side.version}`}
      title={`Open v${side.version} of ${view.processName} on ${view.engine.name}`}
      intent={intent}
    />
  )
}

function PlanActions({ view }: { readonly view: MigrationPlanView }) {
  return (
    <>
      <HeaderButton
        icon={RotateCcwIcon}
        label="Refresh"
        title={`Read ${view.fileName} and ${view.engine.name} again`}
        intent={{ type: "refresh" }}
      />
      <OpenVersionButton view={view} side={view.source} />
      <OpenVersionButton view={view} side={view.target} />
      <HeaderButton
        icon={FileCodeIcon}
        label="Open file"
        title={`Open ${view.fileName}`}
        intent={{ type: "openPlanFile" }}
      />
    </>
  )
}

function PlanFacts({ view }: { readonly view: MigrationPlanView }) {
  return (
    <>
      <span className="text-muted-foreground inline-flex items-center gap-1 tabular-nums">
        v{view.source.version}
        <Icon icon={MoveRightIcon} />
        <span className="sr-only">{" to "}</span>v{view.target.version}
      </span>
      <span className="whitespace-nowrap tabular-nums" data-part="context-key">
        {`${CountLabels.exact(view.running)} running · ${CountLabels.exact(view.withIncident)} with incident`}
      </span>
    </>
  )
}

export function MigrationPlanScreen({ view, freshness, stale, problem }: MigrationPlanScreenProps) {
  return (
    <div className={ScreenFrame.WITH_STRIPS}>
      <ContextBar
        subject="migration"
        title={view.processName}
        engine={view.engine}
        freshness={freshness}
        actions={<PlanActions view={view} />}
      >
        <PlanFacts view={view} />
      </ContextBar>
      <div className={ScreenFrame.STRIPS} data-part="strips">
        {problem}
        <NoticeStrips notices={view.notices} />
      </div>
      <SplitLayout
        top={
          <MigrationDiagrams
            source={view.source}
            target={view.target}
            rows={view.rows}
            focused={view.focused}
            stale={stale}
          />
        }
        bottom={
          <section className={ScreenFrame.LIST_REGION} aria-label="Mapping and check">
            <PlanMappingTable view={view} />
            <PlanVerdict view={view} />
          </section>
        }
      />
    </div>
  )
}
