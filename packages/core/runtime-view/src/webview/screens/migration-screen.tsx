import { Icon, cn } from "@miragon/pulse-ui"
import { MoveRightIcon } from "lucide-react"
import { useMemo, type ReactNode } from "react"
import type { MigrationView } from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { EmptyHint } from "../components/empty-hint.js"
import { RuntimeDiagram } from "../components/runtime-diagram.js"
import type { Decorations } from "../diagram/decoration-layer.js"
import { useHost } from "../host/host-context.js"
import { BulkStrip } from "./bulk-strip.js"
import { MappingTable } from "./mapping-table.js"
import { MigrationActions } from "./migration-actions.js"
import { NoticeStrips } from "./notices.js"
import { SplitLayout } from "./split-layout.js"
import { VersionPicker } from "./version-picker.js"

export interface MigrationScreenProps {
  readonly view: MigrationView
  readonly freshness: Freshness
  readonly stale: boolean
  readonly problem?: ReactNode
}

const UNNAMED = (): void => undefined

const DIAGRAM_CELL = "relative min-h-0 min-w-0"

const DIAGRAM_LABEL =
  "bg-card border-border text-muted-foreground left-gutter absolute top-2 z-[2] rounded-sm border px-1.5 py-0.5 font-semibold tabular-nums"

function useMigrationDecorations(view: MigrationView, stale: boolean) {
  const focusedRow = view.rows.find((row) => row.sourceElementId === view.focused)
  const unmapped = view.rows.filter((row) => row.unmappedTokens === true)
  const source = useMemo<Decorations>(
    () => ({
      badges: [],
      markers: [],
      calls: [],
      stale,
      focusElementId: view.focused,
      unmapped: unmapped.map((row) => row.sourceElementId),
    }),
    [stale, view.focused, unmapped.map((row) => row.sourceElementId).join()],
  )
  const target = useMemo<Decorations>(
    () => ({
      badges: [],
      markers: [],
      calls: [],
      stale,
      focusElementId: focusedRow?.targetElementId,
      candidates: focusedRow?.candidates.map((candidate) => candidate.elementId) ?? [],
    }),
    [stale, focusedRow],
  )
  return { source, target, focusedRow }
}

function Diagrams({ view, stale }: { readonly view: MigrationView; readonly stale: boolean }) {
  const host = useHost()
  const { source, target } = useMigrationDecorations(view, stale)
  const focused = view.focused
  return (
    <div className="@container/migration h-full overflow-y-auto">
      <div className="divide-border grid h-full grid-cols-2 divide-x @max-[900px]/migration:h-auto @max-[900px]/migration:min-h-full @max-[900px]/migration:auto-rows-[minmax(300px,1fr)] @max-[900px]/migration:grid-cols-1 @max-[900px]/migration:divide-x-0 @max-[900px]/migration:divide-y">
        <div className={DIAGRAM_CELL} data-part="migration-diagram">
          <span className={DIAGRAM_LABEL}>v{view.source.version} · from</span>
          <RuntimeDiagram
            xml={view.source.diagramXml}
            decorations={source}
            label={`Diagram of v${view.source.version}, the version to migrate from`}
            keysOnCanvas
            onSelectElement={(elementId) => {
              host.post({ type: "focusMapping", sourceElementId: elementId })
            }}
            onNames={UNNAMED}
          />
        </div>
        {view.target === undefined ? (
          <div
            className={cn(DIAGRAM_CELL, "bg-background grid place-items-center")}
            data-part="migration-diagram"
          >
            <EmptyHint text="Pick the version to migrate to." />
          </div>
        ) : (
          <div className={DIAGRAM_CELL} data-part="migration-diagram">
            <span className={DIAGRAM_LABEL}>v{view.target.version} · to</span>
            <RuntimeDiagram
              xml={view.target.diagramXml}
              decorations={target}
              remembersView={false}
              keysOnCanvas
              label={`Diagram of v${view.target.version}, the version to migrate to`}
              onSelectElement={(elementId) => {
                if (focused !== undefined) {
                  host.post({
                    type: "mapElement",
                    sourceElementId: focused,
                    targetElementId: elementId,
                  })
                }
              }}
              onNames={UNNAMED}
            />
          </div>
        )}
      </div>
    </div>
  )
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
        top={<Diagrams view={view} stale={stale} />}
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
