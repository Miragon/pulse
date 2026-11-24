import { Icon } from "@miragon/pulse-ui"
import { MoveRightIcon } from "lucide-react"
import type { ReactNode } from "react"
import type { MigrationView } from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { useHost } from "../host/host-context.js"
import { BulkStrip } from "./bulk-strip.js"
import { MappingTable } from "./mapping-table.js"
import { MigrationActions } from "./migration-actions.js"
import { MigrationDiagrams } from "./migration-diagrams.js"
import { NoticeStrips } from "./notices.js"
import { SplitLayout } from "./split-layout.js"
import { VersionPicker } from "./version-picker.js"

export interface MigrationScreenProps {
  readonly view: MigrationView
  readonly freshness: Freshness
  readonly stale: boolean
  readonly problem?: ReactNode
}

export function MigrationScreen({ view, freshness, stale, problem }: MigrationScreenProps) {
  const host = useHost()
  return (
    <div className="grid h-full min-w-0 grid-rows-[auto_auto_minmax(0,1fr)]">
      <ContextBar
        subject="migration"
        title={view.processName}
        engine={view.engine}
        freshness={freshness}
      >
        <span className="text-muted-foreground inline-flex items-center gap-1 tabular-nums">
          v{view.source.version}
          <Icon icon={MoveRightIcon} />
        </span>
        <VersionPicker
          versions={view.targets}
          selected={view.target?.definitionId}
          label="Migrate to version"
          placeholder="Pick a version"
          onPick={(definitionId) => {
            host.post({ type: "pickMigrationTarget", definitionId })
          }}
        />
      </ContextBar>
      <div className="flex min-w-0 flex-col" data-part="strips">
        {problem}
        {view.bulk !== undefined && <BulkStrip bulk={view.bulk} />}
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
          <section
            className="bg-card @container/list flex h-full min-h-0 flex-col"
            aria-label="Mapping and migration"
          >
            <MappingTable view={view} />
            <MigrationActions offer={view.offer} summary={view.summary} />
          </section>
        }
      />
    </div>
  )
}
