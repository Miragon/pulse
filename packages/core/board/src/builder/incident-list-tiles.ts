import { BpmnProcessId } from "@miragon/pulse-engine-core"
import type { IncidentListWidget } from "../format/board-definition.js"
import type { IncidentGroupModel, IncidentListModel } from "./board-model.js"
import type { ProbedEngine } from "./engine-probe.js"
import { EngineReads } from "./engine-reads.js"

export class IncidentListTiles {
  static async build(
    widget: IncidentListWidget,
    engines: readonly Promise<ProbedEngine>[],
  ): Promise<IncidentListModel> {
    const process = widget.process === undefined ? undefined : BpmnProcessId(widget.process)
    const groups = await Promise.all(
      engines.map(async (probed): Promise<IncidentGroupModel> => {
        const engine = await probed
        const name = engine.model.name
        const page =
          engine.reads === undefined
            ? undefined
            : EngineReads.valueOf(await engine.reads.incidents(process))
        if (page === undefined) {
          return { engine: name }
        }
        return {
          engine: name,
          incidents: page.items,
          ...(page.next === undefined ? {} : { more: true as const }),
        }
      }),
    )
    return { kind: "incidentList", widget, groups }
  }
}
