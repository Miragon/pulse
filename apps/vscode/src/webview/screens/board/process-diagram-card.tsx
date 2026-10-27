import { useMemo } from "preact/hooks"
import type { InstanceScope, ProcessDiagramTile } from "../../../core/protocol/index.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { Icon } from "../../components/icon.js"
import { glyphs } from "../../components/lucide-glyphs.json"
import { RuntimeDiagram } from "../../components/runtime-diagram.js"
import type { Decorations } from "../../diagram/decoration-layer.js"
import { useHost } from "../../host/host-context.js"
import { BoardCard } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"

function DiagramBody({ tile }: { readonly tile: ProcessDiagramTile }) {
  const host = useHost()
  const diagram = tile.diagram
  const decorations = useMemo<Decorations>(
    () => ({ badges: diagram?.badges ?? [], markers: [], calls: [], stale: false }),
    [diagram],
  )
  if (diagram === undefined) {
    return <EmptyHint text={BoardLabels.diagramMissing(tile)} />
  }
  const open = (elementId: string | undefined, scope: InstanceScope, toSide: boolean): void => {
    host.post({
      type: "openBoardProcess",
      engine: tile.engine,
      bpmnProcessId: tile.bpmnProcessId,
      filter: { scope, ...(elementId === undefined ? {} : { elementId }) },
      toSide,
    })
  }
  return (
    <>
      <p class="board-diagram__meta">
        <span class="muted">{BoardLabels.diagramFacts(tile.engine, diagram.version)}</span>
        <button
          type="button"
          class="button button--secondary button--compact"
          title={`Open ${diagram.processName} on ${tile.engine} (Ctrl/Cmd+click: to the side)`}
          onClick={(event) => {
            open(undefined, "running", event.ctrlKey || event.metaKey)
          }}
        >
          <Icon of={glyphs.Workflow} />
          <span class="button__label">Open process</span>
        </button>
      </p>
      <div class="board-diagram">
        <RuntimeDiagram
          xml={diagram.diagramXml}
          decorations={decorations}
          onSelectElement={(elementId, scope) => {
            const counted = diagram.badges.some((badge) => badge.elementId === elementId)
            if (scope !== undefined || counted) {
              open(elementId, scope ?? "running", false)
            }
          }}
          onNames={() => undefined}
          label={`Diagram of ${diagram.processName} on ${tile.engine}`}
          remembersView={false}
          keysOnCanvas
        />
      </div>
    </>
  )
}

export function ProcessDiagramCard({ tile }: { readonly tile: ProcessDiagramTile }) {
  return (
    <BoardCard title={tile.title} kind="processDiagram">
      <DiagramBody tile={tile} />
    </BoardCard>
  )
}
