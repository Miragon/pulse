import type { DefinitionRef, ElementStatistics } from "@miragon/pulse-engine-core"
import type { ProcessDiagramWidget } from "../format/board-definition.js"
import type { ProcessDiagramModel } from "./board-model.js"
import { DiagramBadges } from "./diagram-badges.js"
import type { ProbedEngine } from "./engine-probe.js"
import { EngineReads } from "./engine-reads.js"

export class ProcessDiagramTiles {
  static async build(
    widget: ProcessDiagramWidget,
    engines: readonly ProbedEngine[],
  ): Promise<ProcessDiagramModel> {
    const tile: ProcessDiagramModel = {
      kind: "processDiagram",
      widget,
      engine: widget.engines[0] ?? "",
    }
    const reads = engines[0]?.reads
    const summaries = reads === undefined ? undefined : EngineReads.valueOf(await reads.summaries())
    if (reads === undefined || summaries === undefined) {
      return tile
    }
    const summary = summaries.find((entry) => entry.latest.bpmnProcessId === widget.process)
    if (summary === undefined) {
      return { ...tile, notDeployed: true }
    }
    const badges = await ProcessDiagramTiles.badges(reads, summary.latest)
    return { ...tile, latest: summary.latest, ...(badges === undefined ? {} : { badges }) }
  }

  private static async badges(
    reads: EngineReads,
    latest: DefinitionRef,
  ): Promise<readonly ElementStatistics[] | undefined> {
    const [xml, statistics] = await Promise.all([
      reads.diagram(latest.id),
      reads.statistics(latest.id),
    ])
    const diagramXml = EngineReads.valueOf(xml)
    const counted = EngineReads.valueOf(statistics)
    if (diagramXml === undefined || counted === undefined) {
      return undefined
    }
    return DiagramBadges.of(diagramXml, counted)
  }
}
