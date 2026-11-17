import { Button, Icon } from "@miragon/pulse-ui"
import { WorkflowIcon } from "lucide-react"
import type { BadgeData, DefinitionData, ProcessDiagramData } from "@miragon/pulse-board"
import { useWords } from "../messages/translate.js"
import { BoardCard, EmptyNote } from "./board-card.js"
import type { BoardSlots } from "./slots.js"
import { diagramTarget, openable } from "./targets.js"
import { diagramMissing, processName, tileTitle, toSideTitle } from "./tile-words.js"

export interface ProcessDiagramTileProps {
  readonly tile: ProcessDiagramData
  readonly slots: Pick<BoardSlots, "Diagram" | "onOpen" | "opens" | "opensToSide">
}

interface DrawnProps extends ProcessDiagramTileProps {
  readonly latest: DefinitionData
  readonly badges: readonly BadgeData[]
}

function DiagramFacts({ tile, slots, latest }: DrawnProps) {
  const t = useWords()
  const process = processName(latest)
  const title = t("diagram.openTitle", { process, engine: tile.engine })
  const target = openable(slots, diagramTarget(tile, "running", undefined))
  return (
    <p className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <span className="text-muted-foreground">
        {t("diagram.facts", { engine: tile.engine, version: latest.version })}
      </span>
      {target !== undefined && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          title={toSideTitle(t, title, slots.opensToSide === true)}
          onClick={(event) => {
            slots.onOpen(target, { toSide: event.ctrlKey || event.metaKey })
          }}
        >
          <Icon icon={WorkflowIcon} />
          {t("diagram.open")}
        </Button>
      )}
    </p>
  )
}

function Drawn(props: DrawnProps) {
  const t = useWords()
  const { tile, slots, latest, badges } = props
  const { Diagram } = slots
  return (
    <>
      <DiagramFacts {...props} />
      <div className="border-border h-80 overflow-hidden rounded-sm border">
        <Diagram
          engine={tile.engine}
          definition={latest}
          badges={badges}
          label={t("diagram.label", { process: processName(latest), engine: tile.engine })}
          onSelect={(elementId, scope) => {
            const counted = badges.some((badge) => badge.elementId === elementId)
            const target = openable(slots, diagramTarget(tile, scope ?? "running", elementId))
            if ((scope !== undefined || counted) && target !== undefined) {
              slots.onOpen(target, { toSide: false })
            }
          }}
        />
      </div>
    </>
  )
}

/** The latest deployed version of a process on one engine, with its counts on the elements. */
export function ProcessDiagramTile({ tile, slots }: ProcessDiagramTileProps) {
  const t = useWords()
  const { latest, badges } = tile
  return (
    <BoardCard title={tileTitle(t, tile)} kind="processDiagram">
      {latest === undefined || badges === undefined ? (
        <EmptyNote text={diagramMissing(t, tile)} />
      ) : (
        <Drawn tile={tile} slots={slots} latest={latest} badges={badges} />
      )}
    </BoardCard>
  )
}
