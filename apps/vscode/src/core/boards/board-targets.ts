import type { BoardTarget, BoardTile, BoardView } from "../protocol/index.js"

export class BoardTargets {
  private readonly tiles: readonly BoardTile[]

  constructor(private readonly view: BoardView) {
    this.tiles = view.rows.flat()
  }

  showsInstance(engine: string, instanceId: string): boolean {
    return this.tiles.some(
      (tile) =>
        tile.kind === "instanceList" &&
        tile.groups.some(
          (group) => group.engine === engine && group.rows.some((row) => row.id === instanceId),
        ),
    )
  }

  showsProcess(engine: string, bpmnProcessId: string): boolean {
    return (
      this.targets().some(
        (target) => target.engine === engine && target.bpmnProcessId === bpmnProcessId,
      ) ||
      this.tiles.some(
        (tile) =>
          tile.kind === "instanceList" &&
          tile.groups.some(
            (group) =>
              group.engine === engine &&
              group.rows.some((row) => row.bpmnProcessId === bpmnProcessId),
          ),
      )
    )
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

  private targets(): readonly BoardTarget[] {
    return this.tiles.flatMap((tile) => {
      if (tile.kind === "counter") {
        return tile.entries.map((entry) => entry.target)
      }
      return tile.kind === "incidentSummary" ? tile.rows.map((row) => row.target) : []
    })
  }
}
