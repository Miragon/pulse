import type { ComponentChildren } from "preact"
import { useMemo } from "preact/hooks"
import type { MigrationView } from "../../core/protocol/index.js"
import { ContextBar, type Freshness } from "../components/context-bar.js"
import { Icon } from "../components/icon.js"
import { glyphs } from "../components/lucide-glyphs.json"
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
  readonly problem?: ComponentChildren
}

const UNNAMED = (): void => undefined

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
    <div class="migration-diagrams">
      <div class="migration-diagrams__grid">
        <div class="migration-diagram">
          <span class="migration-diagram__label">v{view.source.version} · from</span>
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
          <div class="migration-diagram migration-diagram--empty">
            <EmptyHint text="Pick the version to migrate to." />
          </div>
        ) : (
          <div class="migration-diagram">
            <span class="migration-diagram__label">v{view.target.version} · to</span>
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
    <div class="screen screen--with-strips">
      <ContextBar
        subject="migration"
        title={view.processName}
        engine={view.engine}
        freshness={freshness}
      >
        <span class="migration-route">
          v{view.source.version}
          <Icon of={glyphs.MoveRight} />
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
      <div class="strip-stack">
        {problem}
        {view.bulk !== undefined && <BulkStrip bulk={view.bulk} />}
        <NoticeStrips notices={view.notices} />
      </div>
      <SplitLayout
        top={<Diagrams view={view} stale={stale} />}
        bottom={
          <section class="list-region migration-mapping" aria-label="Mapping">
            <MappingTable view={view} />
            <MigrationActions offer={view.offer} summary={view.summary} />
          </section>
        }
      />
    </div>
  )
}
