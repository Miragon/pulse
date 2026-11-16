import { Button, Icon } from "@miragon/pulse-ui"
import { WorkflowIcon } from "lucide-react"
import { useMemo } from "react"
import type {
  BadgeData,
  ElementBadge,
  InstanceScope,
  ProcessDiagramTile,
} from "../../../core/protocol/index.js"
import { EmptyHint } from "../../components/empty-hint.js"
import { RuntimeDiagram } from "../../components/runtime-diagram.js"
import type { Decorations } from "../../diagram/decoration-layer.js"
import { BoardCard, type BoardCallbacks } from "./board-card.js"
import { BoardLabels } from "./board-labels.js"

export interface ProcessDiagramCardProps extends Pick<BoardCallbacks, "onOpen"> {
  readonly tile: ProcessDiagramTile
}

class BoardBadges {
  static of(badges: readonly BadgeData[] | undefined): ElementBadge[] {
    return (badges ?? []).map((badge) => ({
      elementId: badge.elementId,
      running: badge.active,
      incidents: badge.incidents,
      incidentsInCalledInstances: badge.incidentsInCalledInstances,
    }))
  }
}

interface DiagramOpener {
  readonly tile: ProcessDiagramTile
  readonly processName: string
  readonly open: (elementId: string | undefined, scope: InstanceScope, toSide: boolean) => void
}

function DiagramFacts({
  tile,
  processName,
  version,
  open,
}: DiagramOpener & { readonly version: number }) {
  return (
    <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-muted-foreground">
        {BoardLabels.diagramFacts(tile.engine, version)}
      </span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        title={`Open ${processName} on ${tile.engine} (Ctrl/Cmd+click: to the side)`}
        onClick={(event) => {
          open(undefined, "running", event.ctrlKey || event.metaKey)
        }}
      >
        <Icon icon={WorkflowIcon} />
        Open process
      </Button>
    </p>
  )
}

function DiagramBody({ tile, onOpen }: ProcessDiagramCardProps) {
  const { badges, latest, diagramXml } = tile
  const decorations = useMemo<Decorations>(
    () => ({ badges: BoardBadges.of(badges), markers: [], calls: [], stale: false }),
    [badges],
  )
  if (diagramXml === undefined || latest === undefined) {
    return <EmptyHint text={BoardLabels.diagramMissing(tile)} />
  }
  const processName = BoardLabels.processName(latest)
  const open: DiagramOpener["open"] = (elementId, scope, toSide) => {
    onOpen(
      {
        engine: tile.engine,
        bpmnProcessId: tile.widget.process,
        filter: { scope, ...(elementId === undefined ? {} : { elementId }) },
      },
      toSide,
    )
  }
  return (
    <>
      <DiagramFacts tile={tile} processName={processName} version={latest.version} open={open} />
      <div className="border-border h-80 overflow-hidden rounded-sm border">
        <RuntimeDiagram
          xml={diagramXml}
          decorations={decorations}
          onSelectElement={(elementId, scope) => {
            const counted = badges?.some((badge) => badge.elementId === elementId) === true
            if (scope !== undefined || counted) {
              open(elementId, scope ?? "running", false)
            }
          }}
          onNames={() => undefined}
          label={`Diagram of ${processName} on ${tile.engine}`}
          remembersView={false}
          keysOnCanvas
        />
      </div>
    </>
  )
}

export function ProcessDiagramCard({ tile, onOpen }: ProcessDiagramCardProps) {
  return (
    <BoardCard title={BoardLabels.title(tile)} kind="processDiagram">
      <DiagramBody tile={tile} onOpen={onOpen} />
    </BoardCard>
  )
}
