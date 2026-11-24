import type { BoardDiagramProps } from "@miragon/pulse-blocks"
import { createContext, useContext, useMemo } from "react"
import type {
  BadgeData,
  BoardTile,
  ElementBadge,
  InstanceScope,
  ProcessDiagramTile,
} from "../../../core/protocol/index.js"
import { RuntimeDiagram } from "../../components/runtime-diagram.js"
import type { Decorations } from "../../diagram/decorations.js"

export const DiagramXmls = createContext<ReadonlyMap<string, string>>(new Map())

export class BoardDiagrams {
  static keyOf(engine: string, definitionId: string): string {
    return `${engine}|${definitionId}`
  }

  static xmlsOf(rows: readonly (readonly BoardTile[])[]): ReadonlyMap<string, string> {
    return new Map(
      rows
        .flat()
        .filter((tile): tile is ProcessDiagramTile => tile.kind === "processDiagram")
        .flatMap(({ engine, latest, diagramXml }) =>
          latest === undefined || diagramXml === undefined
            ? []
            : [[BoardDiagrams.keyOf(engine, latest.id), diagramXml] as const],
        ),
    )
  }

  static drawable(tile: BoardTile): BoardTile {
    if (tile.kind !== "processDiagram" || tile.diagramXml !== undefined) {
      return tile
    }
    return {
      kind: tile.kind,
      widget: tile.widget,
      engine: tile.engine,
      ...(tile.latest === undefined ? {} : { latest: tile.latest }),
      ...(tile.notDeployed === undefined ? {} : { notDeployed: tile.notDeployed }),
    }
  }

  static badgesOf(badges: readonly BadgeData[]): ElementBadge[] {
    return badges.map((badge) => ({
      elementId: badge.elementId,
      running: badge.active,
      incidents: badge.incidents,
      incidentsInCalledInstances: badge.incidentsInCalledInstances,
    }))
  }

  static scopeOf(scope: InstanceScope | undefined): "running" | "withIncident" | undefined {
    return scope === "running" || scope === "withIncident" ? scope : undefined
  }
}

export function BoardDiagram({ engine, definition, badges, label, onSelect }: BoardDiagramProps) {
  const xml = useContext(DiagramXmls).get(BoardDiagrams.keyOf(engine, definition.id))
  const decorations = useMemo<Decorations>(
    () => ({ badges: BoardDiagrams.badgesOf(badges), markers: [], calls: [], stale: false }),
    [badges],
  )
  if (xml === undefined) {
    return null
  }
  return (
    <RuntimeDiagram
      xml={xml}
      decorations={decorations}
      onSelectElement={(elementId, scope) => {
        onSelect(elementId, BoardDiagrams.scopeOf(scope))
      }}
      onNames={() => undefined}
      label={label}
      remembersView={false}
      keysOnCanvas
    />
  )
}
