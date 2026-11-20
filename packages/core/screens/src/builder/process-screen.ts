import { DiagramBadges } from "@miragon/pulse-board/builder"
import type { DefinitionId, VersionSummary } from "@miragon/pulse-engine-core"
import type { ProcessReadCode } from "../format/process-screen-data.js"
import { CalledProcesses } from "./called-processes.js"
import { CallLinks } from "./call-links.js"
import { OlderVersions } from "./older-versions.js"
import type {
  ProcessFacts,
  ProcessScreenModel,
  ProcessScreenReads,
  ProcessScreenRequest,
} from "./process-screen-model.js"

export class ProcessScreen {
  static async read(
    engine: string,
    request: ProcessScreenRequest,
    reads: ProcessScreenReads,
    now: () => Date,
  ): Promise<ProcessScreenModel | undefined> {
    const asOf = now()
    const { bpmnProcessId } = request
    const versions = await reads.listVersions(bpmnProcessId)
    const selected = ProcessScreen.requestedOf(versions, request)?.definition.id
    if (selected === undefined) {
      return undefined
    }
    const diagram = reads.getDiagramXml(selected).catch(() => undefined)
    const [diagramXml, statistics, calledProcesses] = await Promise.all([
      diagram,
      reads.getElementStatistics(selected).catch(() => undefined),
      CalledProcesses.read(reads, selected, diagram),
    ])
    return ProcessScreen.of({
      engine,
      asOf,
      bpmnProcessId,
      versions,
      selected,
      diagramXml,
      statistics,
      calledProcesses,
    })
  }

  static of(facts: ProcessFacts): ProcessScreenModel {
    const selected = ProcessScreen.selectedOf(facts.versions, facts.selected)
    const notice = OlderVersions.notice(facts.versions, selected)
    return {
      engine: facts.engine,
      asOf: facts.asOf,
      bpmnProcessId: facts.bpmnProcessId,
      selected,
      versions: facts.versions,
      badges:
        facts.statistics === undefined
          ? []
          : DiagramBadges.of(facts.diagramXml ?? "", facts.statistics),
      calls: CallLinks.of(facts.calledProcesses ?? []).links(),
      notices: notice === undefined ? [] : [notice],
      unread: ProcessScreen.unread(facts),
    }
  }

  private static requestedOf(
    versions: readonly VersionSummary[],
    { definitionId, version }: ProcessScreenRequest,
  ): VersionSummary | undefined {
    return (
      versions.find((summary) => summary.definition.id === definitionId) ??
      versions.find((summary) => summary.definition.version === version) ??
      versions[0]
    )
  }

  private static selectedOf(
    versions: readonly VersionSummary[],
    wanted: DefinitionId | undefined,
  ): VersionSummary | undefined {
    return versions.find((version) => version.definition.id === wanted) ?? versions[0]
  }

  private static unread(facts: ProcessFacts): ProcessReadCode[] {
    return [
      ...(facts.diagramXml === undefined ? (["diagram"] as const) : []),
      ...(facts.statistics === undefined ? (["statistics"] as const) : []),
      ...(facts.calledProcesses === undefined ? (["calledProcesses"] as const) : []),
    ]
  }
}
