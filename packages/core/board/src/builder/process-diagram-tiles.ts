import { BpmnProcessId, ProcessTenants, type DefinitionRef } from "@miragon/pulse-engine-core"
import type { ProcessDiagramWidget } from "../format/board-definition.js"
import type { ProcessDiagramModel } from "./board-model.js"
import { DiagramBadges } from "./diagram-badges.js"
import type { ProbedEngine } from "./engine-probe.js"
import { EngineReads } from "./engine-reads.js"
import { XmlTags } from "./xml-tags.js"

export class ProcessDiagramTiles {
  static async build(
    widget: ProcessDiagramWidget,
    engines: readonly Promise<ProbedEngine>[],
  ): Promise<ProcessDiagramModel> {
    const tile: ProcessDiagramModel = {
      kind: "processDiagram",
      widget,
      engine: widget.engines[0] ?? "",
    }
    const reads = (await engines[0])?.reads
    const summaries = reads === undefined ? undefined : EngineReads.valueOf(await reads.summaries())
    if (reads === undefined || summaries === undefined) {
      return tile
    }
    const summary = ProcessTenants.summaryOf(summaries, BpmnProcessId(widget.process))
    if (summary === undefined) {
      return { ...tile, notDeployed: true }
    }
    const drawn = { ...tile, latest: summary.latest }
    return { ...drawn, ...(await ProcessDiagramTiles.badges(reads, drawn)) }
  }

  private static async badges(
    reads: EngineReads,
    tile: ProcessDiagramModel & { readonly latest: DefinitionRef },
  ): Promise<Pick<ProcessDiagramModel, "badges" | "diagramTooLong">> {
    const { latest, widget } = tile
    const [xml, statistics] = await Promise.all([
      reads.diagram(latest.id),
      reads.statistics(latest.id),
    ])
    const diagramXml = EngineReads.valueOf(xml)
    const counted = EngineReads.valueOf(statistics)
    if (diagramXml === undefined || counted === undefined) {
      return {}
    }
    const badges = DiagramBadges.of(diagramXml, counted)
    if (XmlTags.readable(diagramXml)) {
      return { badges }
    }
    const title = widget.title ?? latest.name ?? widget.process
    return { badges, diagramTooLong: { title, engine: tile.engine } }
  }
}
