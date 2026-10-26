import { BpmnStructure } from "../bpmn/bpmn-structure.js"
import type { InstanceHeader, InstanceView, ParentLink } from "../protocol/index.js"
import { CalledInstanceLinks } from "./called-instance-links.js"
import { CallLinks } from "./call-links.js"
import { IncidentRows } from "./incident-rows.js"
import { InstanceHeadline } from "./instance-headline.js"
import { InstanceMarkers } from "./instance-markers.js"
import { MoveOptions } from "./move-options.js"
import type { InstanceSnapshot } from "./instance-snapshot.js"
import { Labels } from "./labels.js"
import { PathRows } from "./path-rows.js"
import { VariableRows } from "./variable-rows.js"
import { WaitRows } from "./wait-rows.js"
import { WebUiLinks } from "./web-ui-links.js"

export class InstanceViewBuilder {
  constructor(private readonly snapshot: InstanceSnapshot) {}

  build(): InstanceView {
    const { detail } = this.snapshot
    const links = new CalledInstanceLinks(detail)
    const incidents = new IncidentRows(this.snapshot, links).rows()
    const headline = InstanceHeadline.of(incidents, detail.instance.state)
    const header = this.header()
    const waitRows = new WaitRows(detail, links).rows()
    const waits = this.snapshot.writable
      ? new MoveOptions(detail, this.snapshot.diagramXml).applied(waitRows)
      : { rows: waitRows, moves: [] }
    return {
      kind: "instance",
      engine: this.snapshot.engine,
      asOf: this.snapshot.asOf.toISOString(),
      instance: header,
      diagramXml: this.snapshot.diagramXml,
      markers: new InstanceMarkers(detail, BpmnStructure.of(this.snapshot.diagramXml)).markers(),
      calls: CallLinks.ofInstance(this.snapshot.calledProcesses, detail).links(
        this.snapshot.engine.name,
      ),
      incidents,
      waitStates: waits.rows,
      path: new PathRows(detail).rows(),
      variables: new VariableRows(detail, this.snapshot.writable).rows(),
      truncated: detail.truncated,
      ...(waits.moves.length === 0 ? {} : { moves: waits.moves }),
      ...(headline === undefined ? {} : { headline }),
      ...WebUiLinks.to(header.businessKey ?? header.shortId, this.snapshot.engine),
    }
  }

  private header(): InstanceHeader {
    const { instance } = this.snapshot.detail
    return {
      id: instance.id,
      shortId: Labels.shortId(instance.id),
      state: Labels.instanceState(instance.state),
      processName: instance.definition.name ?? instance.definition.bpmnProcessId,
      bpmnProcessId: instance.definition.bpmnProcessId,
      version: instance.definition.version,
      definitionId: instance.definition.id,
      ...(instance.businessKey === undefined ? {} : { businessKey: instance.businessKey }),
      ...(instance.startedAt === undefined ? {} : { startedAt: instance.startedAt }),
      ...(instance.endedAt === undefined ? {} : { endedAt: instance.endedAt }),
      ...(instance.parentInstanceId === undefined
        ? {}
        : { parent: this.parentLink(instance.parentInstanceId) }),
    }
  }

  private parentLink(instanceId: string): ParentLink {
    return { instanceId, label: `from ${Labels.shortId(instanceId)}` }
  }
}
