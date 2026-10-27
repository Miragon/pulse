import { BpmnProcessId, type Incident } from "../../contract/index.js"
import type { BoardIncidentRow, IncidentGroup, IncidentListTile } from "../protocol/index.js"
import { Labels } from "../views/labels.js"
import type { IncidentListWidget } from "./board-definition.js"
import { EngineReads } from "./engine-reads.js"
import type { ProbedEngine } from "./engine-probe.js"

export class IncidentListTiles {
  static async build(
    widget: IncidentListWidget,
    engines: readonly ProbedEngine[],
  ): Promise<IncidentListTile> {
    const process = widget.process === undefined ? undefined : BpmnProcessId(widget.process)
    const groups = await Promise.all(
      engines.map(async (engine): Promise<IncidentGroup> => {
        const name = engine.status.name
        const page =
          engine.reads === undefined
            ? undefined
            : EngineReads.valueOf(await engine.reads.incidents(process))
        if (page === undefined) {
          return { engine: name, rows: [], unavailable: true }
        }
        return {
          engine: name,
          rows: page.items.map((incident) => IncidentListTiles.row(name, incident)),
          ...(page.next === undefined ? {} : { more: true as const }),
        }
      }),
    )
    return {
      kind: "incidentList",
      title:
        widget.title ??
        (widget.process === undefined ? "Open incidents" : `Open incidents of ${widget.process}`),
      groups,
    }
  }

  private static row(engine: string, incident: Incident): BoardIncidentRow {
    return {
      engine,
      id: incident.id,
      instanceId: incident.instanceId,
      shortInstanceId: Labels.shortId(incident.instanceId),
      processName: incident.definition.name ?? incident.definition.bpmnProcessId,
      bpmnProcessId: incident.definition.bpmnProcessId,
      elementId: incident.elementId,
      message: incident.message,
      createdAt: incident.createdAt,
    }
  }
}
