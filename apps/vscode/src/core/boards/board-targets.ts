import type {
  BoardTarget,
  BoardTile,
  BoardView,
  InstanceListFilter,
  ProcessDiagramTile,
} from "../protocol/index.js"

const DIAGRAM_SCOPES: readonly string[] = ["running", "withIncident"]

export class BoardTargets {
  private readonly tiles: readonly BoardTile[]

  constructor(private readonly view: BoardView) {
    this.tiles = view.rows.flat()
  }

  showsInstance(engine: string, instanceId: string): boolean {
    return this.tiles.some((tile) => {
      if (tile.kind === "instanceList") {
        return tile.groups.some(
          (group) => group.engine === engine && group.rows.some((row) => row.id === instanceId),
        )
      }
      return (
        tile.kind === "incidentList" &&
        tile.groups.some(
          (group) =>
            group.engine === engine && group.rows.some((row) => row.instanceId === instanceId),
        )
      )
    })
  }

  showsProcess(engine: string, bpmnProcessId: string, filter: InstanceListFilter): boolean {
    const asked = JSON.stringify(filter)
    const listed = this.targets().some(
      (target) =>
        target.engine === engine &&
        target.bpmnProcessId === bpmnProcessId &&
        JSON.stringify(target.filter) === asked,
    )
    return listed || this.diagrams(engine, bpmnProcessId).some((tile) => this.draws(tile, filter))
  }

  reaches(engine: string): boolean {
    return this.view.engines.some(
      (status) => status.name === engine && status.state !== "notConfigured",
    )
  }

  configures(engine: string): boolean {
    return this.view.engines.some(
      (status) => status.name === engine && status.problem?.needsCredentials === true,
    )
  }

  private diagrams(engine: string, bpmnProcessId: string): readonly ProcessDiagramTile[] {
    return this.tiles.filter(
      (tile): tile is ProcessDiagramTile =>
        tile.kind === "processDiagram" &&
        tile.engine === engine &&
        tile.bpmnProcessId === bpmnProcessId &&
        tile.diagram !== undefined,
    )
  }

  private draws(tile: ProcessDiagramTile, filter: InstanceListFilter): boolean {
    if (!DIAGRAM_SCOPES.includes(filter.scope) || filter.businessKey !== undefined) {
      return false
    }
    const elementId = filter.elementId
    return (
      elementId === undefined ||
      (tile.diagram?.badges.some((badge) => badge.elementId === elementId) ?? false)
    )
  }

  private targets(): readonly BoardTarget[] {
    return this.tiles.flatMap((tile) => {
      if (tile.kind === "counter") {
        return tile.entries.flatMap((entry) => (entry.target === undefined ? [] : [entry.target]))
      }
      return tile.kind === "incidentSummary" ? tile.rows.map((row) => row.target) : []
    })
  }
}
