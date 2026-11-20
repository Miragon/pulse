import type { InstanceScreenData } from "@miragon/pulse-screens"
import { InstanceScreen, ScreenJson } from "@miragon/pulse-screens/builder"
import type { InstanceHeader, InstanceView } from "../protocol/index.js"
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
  private readonly screen: InstanceScreenData

  constructor(private readonly snapshot: InstanceSnapshot) {
    const { engine, asOf, detail, diagramXml, calledProcesses, fullDetails } = snapshot
    this.screen = ScreenJson.instance(
      InstanceScreen.of({
        engine: engine.name,
        asOf,
        detail,
        diagramXml,
        calledProcesses,
        caller: undefined,
        fullDetails,
      }),
    )
  }

  build(): InstanceView {
    const { detail } = this.snapshot
    const incidents = new IncidentRows(this.snapshot, this.screen.incidents).rows()
    const head = InstanceHeadline.headOf(this.screen.headline)
    const headline = InstanceHeadline.of(this.screen.headline, incidents)
    const header = this.header()
    const waitRows = WaitRows.of(this.screen.waits)
    const waits = this.snapshot.writable
      ? new MoveOptions(detail, this.snapshot.diagramXml, this.snapshot.cli).applied(waitRows)
      : { rows: waitRows, moves: [] }
    return {
      kind: "instance",
      engine: this.snapshot.engine,
      asOf: this.screen.asOf,
      instance: header,
      diagramXml: this.snapshot.diagramXml,
      markers: InstanceMarkers.of(detail, this.snapshot.diagramXml, this.screen.markers),
      calls: CallLinks.ofInstance(this.screen.calls).links(this.snapshot.engine.name),
      incidents,
      waitStates: waits.rows,
      path: PathRows.of(this.screen.path),
      variables: new VariableRows(detail, this.snapshot.writable).rows(),
      truncated: this.screen.truncated,
      ...(waits.moves.length === 0 ? {} : { moves: waits.moves }),
      ...(head === undefined ? {} : { head }),
      ...(headline === undefined ? {} : { headline }),
      ...WebUiLinks.to(header.businessKey ?? header.shortId, this.snapshot.engine),
    }
  }

  private header(): InstanceHeader {
    const { instance, caller } = this.screen
    const { definition } = instance
    return {
      id: instance.id,
      shortId: Labels.shortId(instance.id),
      state: Labels.instanceState(instance.state),
      processName: definition.name ?? definition.bpmnProcessId,
      bpmnProcessId: definition.bpmnProcessId,
      version: definition.version,
      definitionId: definition.id,
      ...(instance.businessKey === undefined ? {} : { businessKey: instance.businessKey }),
      ...(instance.startedAt === undefined ? {} : { startedAt: instance.startedAt }),
      ...(instance.endedAt === undefined ? {} : { endedAt: instance.endedAt }),
      ...(caller === null
        ? {}
        : {
            parent: {
              instanceId: caller.instanceId,
              label: `from ${Labels.shortId(caller.instanceId)}`,
            },
          }),
    }
  }
}
