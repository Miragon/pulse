import { cn } from "@miragon/pulse-ui"
import { useMemo } from "react"
import { EmptyHint } from "../components/empty-hint.js"
import { RuntimeDiagram } from "../components/runtime-diagram.js"
import type { Decorations } from "../diagram/decoration-layer.js"
import { useHost } from "../host/host-context.js"

interface DiagramSide {
  readonly version: number
  readonly diagramXml: string
}

interface DiagramRow {
  readonly sourceElementId: string
  readonly targetElementId?: string
  readonly unmappedTokens?: true
  readonly candidates?: readonly { readonly elementId: string }[]
}

export interface MigrationDiagramsProps {
  readonly source: DiagramSide
  readonly target: DiagramSide | undefined
  readonly rows: readonly DiagramRow[]
  readonly focused: string | undefined
  readonly stale: boolean
  readonly onMap?: (sourceElementId: string, targetElementId: string) => void
}

const UNNAMED = (): void => undefined

const DIAGRAM_CELL = "relative min-h-0 min-w-0"

const DIAGRAM_LABEL =
  "bg-card border-border text-muted-foreground left-gutter absolute top-2 z-[2] rounded-sm border px-1.5 py-0.5 font-semibold tabular-nums"

function useMigrationDecorations(
  { rows, focused, stale }: Pick<MigrationDiagramsProps, "rows" | "focused" | "stale">,
  maps: boolean,
) {
  const focusedRow = rows.find((row) => row.sourceElementId === focused)
  const source = useMemo<Decorations>(
    () => ({
      badges: [],
      markers: [],
      calls: [],
      stale,
      focusElementId: focused,
      unmapped: rows.filter((row) => row.unmappedTokens === true).map((row) => row.sourceElementId),
    }),
    [stale, focused, rows],
  )
  const target = useMemo<Decorations>(
    () => ({
      badges: [],
      markers: [],
      calls: [],
      stale,
      focusElementId: focusedRow?.targetElementId,
      candidates: maps
        ? (focusedRow?.candidates?.map((candidate) => candidate.elementId) ?? [])
        : [],
    }),
    [stale, focusedRow, maps],
  )
  return { source, target }
}

export function MigrationDiagrams({ source, target, onMap, ...shown }: MigrationDiagramsProps) {
  const host = useHost()
  const decorations = useMigrationDecorations(shown, onMap !== undefined)
  const { focused } = shown
  return (
    <div className="@container/migration h-full overflow-y-auto">
      <div className="divide-border grid h-full grid-cols-2 divide-x @max-[900px]/migration:h-auto @max-[900px]/migration:min-h-full @max-[900px]/migration:auto-rows-[minmax(300px,1fr)] @max-[900px]/migration:grid-cols-1 @max-[900px]/migration:divide-x-0 @max-[900px]/migration:divide-y">
        <div className={DIAGRAM_CELL} data-part="migration-diagram">
          <span className={DIAGRAM_LABEL}>v{source.version} · from</span>
          <RuntimeDiagram
            xml={source.diagramXml}
            decorations={decorations.source}
            label={`Diagram of v${source.version}, the version to migrate from`}
            keysOnCanvas
            onSelectElement={(elementId) => {
              host.post({ type: "focusMapping", sourceElementId: elementId })
            }}
            onNames={UNNAMED}
          />
        </div>
        {target === undefined ? (
          <div
            className={cn(DIAGRAM_CELL, "bg-background grid place-items-center")}
            data-part="migration-diagram"
          >
            <EmptyHint text="Pick the version to migrate to." />
          </div>
        ) : (
          <div className={DIAGRAM_CELL} data-part="migration-diagram">
            <span className={DIAGRAM_LABEL}>v{target.version} · to</span>
            <RuntimeDiagram
              xml={target.diagramXml}
              decorations={decorations.target}
              remembersView={false}
              keysOnCanvas
              label={`Diagram of v${target.version}, the version to migrate to`}
              onSelectElement={(elementId) => {
                if (onMap !== undefined && focused !== undefined) {
                  onMap(focused, elementId)
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
