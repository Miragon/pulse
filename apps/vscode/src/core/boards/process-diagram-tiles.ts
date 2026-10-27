import type { DefinitionSummary } from "../../contract/index.js"
import type { BoardDiagram, ProcessDiagramTile } from "../protocol/index.js"
import { ElementBadges } from "../views/element-badges.js"
import type { ProcessDiagramWidget } from "./board-definition.js"
import { EngineReads } from "./engine-reads.js"
import type { ProbedEngine } from "./engine-probe.js"

export class ProcessDiagramTiles {
  static async build(
    widget: ProcessDiagramWidget,
    engines: readonly ProbedEngine[],
  ): Promise<ProcessDiagramTile> {
    const tile: ProcessDiagramTile = {
      kind: "processDiagram",
      title: widget.title ?? widget.process,
      engine: widget.engines[0] ?? "",
      bpmnProcessId: widget.process,
    }
    const reads = engines[0]?.reads
    const summaries = reads === undefined ? undefined : EngineReads.valueOf(await reads.summaries())
    if (reads === undefined || summaries === undefined) {
      return tile
    }
    const summary = summaries.find((entry) => entry.latest.bpmnProcessId === widget.process)
    return summary === undefined
      ? { ...tile, notDeployed: true }
      : ProcessDiagramTiles.drawn(widget, tile, reads, summary)
  }

  private static async drawn(
    widget: ProcessDiagramWidget,
    tile: ProcessDiagramTile,
    reads: EngineReads,
    summary: DefinitionSummary,
  ): Promise<ProcessDiagramTile> {
    const diagram = await ProcessDiagramTiles.diagram(reads, summary)
    return {
      ...tile,
      title: widget.title ?? summary.latest.name ?? widget.process,
      ...(diagram === undefined ? {} : { diagram }),
    }
  }

  private static async diagram(
    reads: EngineReads,
    summary: DefinitionSummary,
  ): Promise<BoardDiagram | undefined> {
    const latest = summary.latest
    const [xml, statistics] = await Promise.all([
      reads.diagram(latest.id),
      reads.statistics(latest.id),
    ])
    const diagramXml = EngineReads.valueOf(xml)
    const counted = EngineReads.valueOf(statistics)
    if (diagramXml === undefined || counted === undefined) {
      return undefined
    }
    return {
      processName: latest.name ?? latest.bpmnProcessId,
      version: latest.version,
      diagramXml,
      badges: ElementBadges.of(diagramXml, counted),
    }
  }
}
