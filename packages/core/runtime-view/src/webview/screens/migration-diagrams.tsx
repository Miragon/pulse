import { cn } from "@miragon/pulse-ui"
import { useCallback, useId, useMemo, useRef, useState, type RefObject } from "react"
import { EmptyHint } from "../components/empty-hint.js"
import { RuntimeDiagram } from "../components/runtime-diagram.js"
import type { Decorations } from "../diagram/decorations.js"
import type { ArrowTone } from "../diagram/mapping-arrows.js"
import { useHost } from "../host/host-context.js"
import { MappingBar } from "./mapping-bar.js"
import { useMappingDraw, type MappingDraw } from "./mapping-draw.js"
import { MappingScene, type DiagramRow, type Hovered } from "./mapping-scene.js"
import {
  useAllMappings,
  useArrowLayer,
  useArrowScene,
  useLinkedViews,
  useMappingDecoration,
  useMigrationDecorations,
  type DiagramSideName,
  type LinkedViews,
} from "./mapping-views.js"

interface DiagramSide {
  readonly version: number
  readonly diagramXml: string
}

export interface MigrationDiagramsProps {
  readonly source: DiagramSide
  readonly target: DiagramSide | undefined
  readonly rows: readonly DiagramRow[]
  readonly focused: string | undefined
  readonly stale: boolean
}

const DIAGRAM_CELL = "relative min-h-0 min-w-0"

const DIAGRAM_LABEL =
  "bg-card border-border text-muted-foreground left-gutter absolute top-2 z-[2] rounded-sm border px-1.5 py-0.5 font-semibold tabular-nums"

const TONES: readonly ArrowTone[] = ["info", "danger"]

interface DiagramCellProps {
  readonly side: DiagramSideName
  readonly cell: RefObject<HTMLDivElement | null>
  readonly diagram: DiagramSide
  readonly decorations: Decorations
  readonly views: LinkedViews
  readonly onSelect: (elementId: string) => void
  readonly onHover: (hovered: Hovered | undefined) => void
  readonly onDrawn: (side: DiagramSideName) => void
}

function DiagramCell({ side, cell, diagram, decorations, views, ...on }: DiagramCellProps) {
  const role = side === "source" ? "from" : "to"
  return (
    <div
      ref={cell}
      className={DIAGRAM_CELL}
      data-part="migration-diagram"
      onPointerDownCapture={() => {
        views.touch(side)
      }}
      onPointerMoveCapture={(event) => {
        if (event.buttons !== 0) {
          views.touch(side)
        }
      }}
      onWheelCapture={() => {
        views.touch(side)
      }}
      onKeyDownCapture={() => {
        views.touch(side)
      }}
    >
      <span className={DIAGRAM_LABEL}>
        v{diagram.version} · {role}
      </span>
      <RuntimeDiagram
        xml={diagram.diagramXml}
        decorations={decorations}
        label={`Diagram of v${String(diagram.version)}, the version to migrate ${role}`}
        keysOnCanvas
        {...(side === "target" ? { remembersView: false } : {})}
        onSelectElement={on.onSelect}
        onNames={() => {
          on.onDrawn(side)
        }}
        onHover={(elementId) => {
          on.onHover(elementId === undefined ? undefined : { side, elementId })
        }}
        onViewChange={() => {
          views.changed(side)
        }}
        onCanvas={(view) => {
          views.offer(side, view)
        }}
      />
    </div>
  )
}

function NoTarget() {
  return (
    <div
      className={cn(DIAGRAM_CELL, "bg-background grid place-items-center")}
      data-part="migration-diagram"
    >
      <EmptyHint text="Pick the version to migrate to." />
    </div>
  )
}

function ArrowSvg({
  group,
  markerOf,
}: {
  readonly group: RefObject<SVGGElement | null>
  readonly markerOf: (tone: ArrowTone) => string
}) {
  return (
    <svg className="mapping-arrows" aria-hidden="true" data-part="mapping-arrows">
      <defs>
        {TONES.map((tone) => (
          <marker
            key={tone}
            id={markerOf(tone)}
            className="mapping-arrow-head"
            data-tone={tone}
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" />
          </marker>
        ))}
      </defs>
      <g ref={group} />
    </svg>
  )
}

function useMappedDiagrams({ rows, focused, stale, target }: MigrationDiagramsProps) {
  const host = useHost()
  const markers = useId()
  const sourceCell = useRef<HTMLDivElement>(null)
  const targetCell = useRef<HTMLDivElement>(null)
  const group = useRef<SVGGElement>(null)
  const [hovered, setHovered] = useState<Hovered | undefined>(undefined)
  const [showAll, setShowAll] = useAllMappings()
  const markerOf = useCallback((tone: ArrowTone) => `${markers}-${tone}`, [markers])
  const layer = useArrowLayer(group, sourceCell, targetCell, markerOf)
  const draw: MappingDraw = useMappingDraw({
    rows,
    target: targetCell,
    onPointer: (point) => {
      layer.current?.follow(point)
    },
    onDrop: (sourceElementId, targetElementId) => {
      host.post({ type: "mapElement", sourceElementId, targetElementId })
    },
  })
  const scene = useMemo(
    () => MappingScene.arrows({ rows, focused, hovered, drawing: draw.drawing, showAll }),
    [rows, focused, hovered, draw.drawing, showAll],
  )
  useArrowScene(layer, scene)
  const redraw = (): void => {
    layer.current?.redraw()
  }
  const views = useLinkedViews(redraw)
  const onDrawn = (side: DiagramSideName): void => {
    views.drawn(side)
    redraw()
  }
  const mapping = useMappingDecoration(
    rows,
    target?.version,
    draw.drawing?.from ?? focused,
    draw.start,
  )
  const decorations = useMigrationDecorations(
    { rows, focused, stale, hovered, drawing: draw.drawing },
    mapping,
  )
  const cells = { source: sourceCell, target: targetCell }
  return {
    host,
    cells,
    group,
    markerOf,
    draw,
    views,
    decorations,
    showAll,
    setShowAll,
    setHovered,
    redraw,
    onDrawn,
  }
}

export function MigrationDiagrams(props: MigrationDiagramsProps) {
  const { source, target, rows, focused } = props
  const shown = useMappedDiagrams(props)
  const { host, cells, draw, views, decorations } = shown
  const common = { views, onHover: shown.setHovered, onDrawn: shown.onDrawn }
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="@container/migration min-h-0 flex-1 overflow-y-auto" onScroll={shown.redraw}>
        <div className="divide-border relative grid h-full grid-cols-2 divide-x @max-[900px]/migration:h-auto @max-[900px]/migration:min-h-full @max-[900px]/migration:auto-rows-[minmax(300px,1fr)] @max-[900px]/migration:grid-cols-1 @max-[900px]/migration:divide-x-0 @max-[900px]/migration:divide-y">
          <DiagramCell
            side="source"
            cell={cells.source}
            diagram={source}
            decorations={decorations.source}
            onSelect={(elementId) => {
              draw.end()
              host.post({ type: "focusMapping", sourceElementId: elementId })
            }}
            {...common}
          />
          {target === undefined ? (
            <NoTarget />
          ) : (
            <DiagramCell
              side="target"
              cell={cells.target}
              diagram={target}
              decorations={decorations.target}
              onSelect={(elementId) => {
                const from = draw.drawing?.from ?? focused
                draw.end()
                if (from !== undefined) {
                  host.post({
                    type: "mapElement",
                    sourceElementId: from,
                    targetElementId: elementId,
                  })
                }
              }}
              {...common}
            />
          )}
          <ArrowSvg group={shown.group} markerOf={shown.markerOf} />
        </div>
      </div>
      {target !== undefined && (
        <MappingBar
          showAll={shown.showAll}
          onShowAll={shown.setShowAll}
          linked={views.linked}
          onLinked={views.link}
          hint={MappingScene.hint(rows, draw.drawing, target.version)}
        />
      )}
    </div>
  )
}
