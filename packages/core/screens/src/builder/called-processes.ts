import { CallActivities } from "@miragon/pulse-board/builder"
import type { CalledProcess, DefinitionId, ProcessRuntime } from "@miragon/pulse-engine-core"

type CalledProcessReads = Pick<ProcessRuntime, "getCalledProcesses">

export class CalledProcesses {
  static async read(
    reads: CalledProcessReads,
    definitionId: DefinitionId,
    diagramXml: Promise<string | undefined>,
  ): Promise<readonly CalledProcess[] | undefined> {
    const xml = await diagramXml
    if (xml !== undefined && CallActivities.found(xml) === false) {
      return []
    }
    return reads.getCalledProcesses(definitionId).catch(() => undefined)
  }
}
